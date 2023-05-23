import fs from 'fs';
import path from 'path';

function readdirRecursive(root: string): string[] {
  const files = fs.readdirSync(root, { withFileTypes: true });
  return files.flatMap((file) => {
    const fullPath = path.join(root, file.name);
    return file.isDirectory() ? readdirRecursive(fullPath) : fullPath;
  });
}

const entrypoints = [
  './bun',
  './node',
  './thirdparty'
].flatMap((dir) => readdirRecursive(dir))
  .map(file => {
    const contents = fs.readFileSync(file, 'utf8');
    const comment = contents.indexOf('// @module');
    if (comment === -1) {
      return null;
    }
    const moduleName = JSON.parse(contents.slice(comment + 10, contents.indexOf('\n', comment)));
    return { name: moduleName, file }
  }).filter(Boolean) as { name: string, file: string }[];

const build = await Bun.build({
  entrypoints: entrypoints.map(({ file }) => file),
  external: entrypoints.map(({ name }) => name),
  outdir: './dist/modules',
  sourcemap: 'external',
  minify: true,
});
