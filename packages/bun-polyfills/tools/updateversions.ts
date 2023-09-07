import path from 'path';

const abort = (...msg: string[]): never => (console.error(...msg), process.exit(1));

const makefilePath = path.resolve(import.meta.dir, '../../../Makefile');
const makefile = Bun.file(makefilePath);
if (!await makefile.exists()) abort('Makefile not found at', makefilePath);

const makefileContent = await makefile.text();
const matched = makefileContent.match(/^BUN_BASE_VERSION\s*=\s*(\d+.\d+)/m);
if (!matched) abort('Could not find BUN_BASE_VERSION in Makefile');

const buildidPath = path.resolve(import.meta.dir, '../../../src/build-id');
const buildid = Bun.file(buildidPath);
if (!await buildid.exists()) abort('Build ID file not found at', buildidPath);

const [, BUN_BASE_VERSION] = matched!;
const BUN_VERSION = `${BUN_BASE_VERSION}.${await buildid.text()}`.trim();

const bunTsPath = path.resolve(import.meta.dir, '../src/modules/bun.ts');
const bunTs = Bun.file(bunTsPath);
if (!await bunTs.exists()) abort('bun.ts source file not found at', bunTsPath);

const bunTsContent = await bunTs.text();
const bunTsContentNew = bunTsContent.replace(
    /^export const version = '.+' satisfies typeof Bun.version;$/m,
    `export const version = '${BUN_VERSION}' satisfies typeof Bun.version;`
);
if (bunTsContentNew !== bunTsContent) console.info('Updated Bun.version polyfill to', BUN_VERSION);

const git = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'] });
if (!git.success) abort('Could not get git HEAD commit hash');
const BUN_REVISION = git.stdout.toString('utf8').trim();

const bunTsContentNewer = bunTsContentNew.replace(
    /^export const revision = '.+' satisfies typeof Bun.revision;$/m,
    `export const revision = '${BUN_REVISION}' satisfies typeof Bun.revision;`
);
if (bunTsContentNewer !== bunTsContentNew) console.info('Updated Bun.revision polyfill to', BUN_REVISION);

Bun.write(bunTs, bunTsContentNewer);
