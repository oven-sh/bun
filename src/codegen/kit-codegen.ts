import { join, basename } from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert';

// arg parsing
const options = {};
for (const arg of process.argv.slice(2)) {
  if(!arg.startsWith('--')) {
    console.error('Unknown argument ' + arg);
    process.exit(1);
  }
  const split = arg.split('=');
  const value = split[1] || 'true';
  options[split[0].slice(2)] = value;
}

let { codegen_root, debug } = options as any;
if (!codegen_root) {console.error('Missing --codegen_root=...'); process.exit(1);}
if (debug === 'false' || debug === '0' || debug == 'OFF') debug = false;

const kit_dir = join(import.meta.dirname, '../kit');
process.chdir(kit_dir); // to make bun build predictable in development

const results = await Promise.allSettled(['client', 'server'].map(async mode => {
  let result = await Bun.build({
    entrypoints: [join(kit_dir, 'hmr-runtime.ts')],
    define: {
      mode: JSON.stringify(mode),
      IS_BUN_DEVELOPMENT: String(!!debug),
    },
    minify: {
      syntax: true,
    }
  });
  if(!result.success) throw new AggregateError(result.logs);
  assert(result.outputs.length === 1, 'must bundle to a single file');
  // @ts-ignore
  let code = await result.outputs[0].text();

  // A second pass is used to convert global variables into parameters, while
  // allowing for renaming to properly function when minification is enabled.
  const in_names = [
    'input_graph',
    'config',
    mode === 'server' && 'server_exports'
  ].filter(Boolean);
  const combined_source = `
    __marker__;
    let ${in_names.join(',')};
    __marker__(${in_names.join(',')});
    ${code};
  `;
  const generated_entrypoint = join(kit_dir, `.runtime-${mode}.generated.ts`);
  
  writeFileSync(generated_entrypoint, combined_source);
  using _ = {[Symbol.dispose] : () => {
    try {
      rmSync(generated_entrypoint);
    } catch {}
  }};

  result = await Bun.build({
    entrypoints: [generated_entrypoint],
    minify: {
      syntax: true,
      whitespace: !debug,
      identifiers: !debug,
    }
  });
  if(!result.success) throw new AggregateError(result.logs);
  assert(result.outputs.length === 1, 'must bundle to a single file');
  // @ts-ignore
  code = await result.outputs[0].text();
  
  let names: string = '';
  code = code
    .replace(/(\n?)\s*__marker__.*__marker__\((.+?)\);\s*/s, (_, n, captured) => {
      names = captured;
      return n;
    })
    .replace(`// ${basename(generated_entrypoint)}`, '')
    .trim();
  assert(names, 'missing name');

  if (debug) {
    code = '\n  ' + code.replace(/\n/g, '\n  ') + '\n';
  }

  if (code[code.length - 1] === ';') code = code.slice(0, -1);

  if (mode === 'server') {
    const server_fetch_function = names.split(',')[2].trim();
    code = debug
      ? `${code}  return ${server_fetch_function};\n`
      : `${code};return ${server_fetch_function};`
  }

  code = debug
    ? `((${names}) => {${code}})({\n`
    : `((${names})=>{${code}})({`;

  if (mode === 'server') {
    code = `export default await ${code}`;
  }

  writeFileSync(join(codegen_root, `kit.${mode}.js`), code);
}));

// print failures in a de-duplicated fashion.
interface Err { kind: 'client' | 'server' | 'both', err: any }
const failed = [
  { kind: 'client', result: results[0] },
  { kind: 'server', result: results[1] },
]
  .filter(x => x.result.status === 'rejected')
  .map(x => ({ kind: x.kind, err: x.result.reason })) as Err[];
if(failed.length > 0) {
  const flattened_errors: Err[] = [];
  for (const { kind, err } of failed) {
    if (err instanceof AggregateError) {
      flattened_errors.push(...err.errors.map(err => ({ kind, err })));
    }
    flattened_errors.push({ kind, err });
  }
  for(let i = 0; i < flattened_errors.length; i++) {
    const x = flattened_errors[i];
    if (!x.err?.message) continue;
    for (const other of flattened_errors.slice(0, i)) {
      if(other.err?.message === x.err.message || other.err.stack === x.err.stack) {
        other.kind = 'both';
        flattened_errors.splice(i, 1);
        i -= 1;
        continue;
      }
    }
  }
  let current = '';
  for(const { kind, err } of flattened_errors) {
    if(kind !== current) {
      const map = { both: 'runtime', client: 'client runtime', server: 'server runtime' }
      console.error(`Errors while bundling Kit ${map[kind]}:`);
    }
    console.error(err);
  }
  process.exit(1);
} else {
  console.log('-> kit.client.js, kit.server.js');

  const empty_file = join(codegen_root, 'kit_empty_file');
  if (!existsSync(empty_file))
    writeFileSync(empty_file, 'this is used to fulfill a cmake dependency');
}
