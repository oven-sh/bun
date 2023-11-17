/// <reference types="bun-types" />
import path from 'path';

const abort = (...msg: string[]): never => (console.error(...msg), process.exit(1));

const cmakelistsPath = path.resolve(import.meta.dir, '../../../CMakeLists.txt');
const cmakelistsFile = Bun.file(cmakelistsPath);
if (!await cmakelistsFile.exists()) abort('CMakeLists.txt not found at', cmakelistsPath);

const cmakelists = await cmakelistsFile.text();
const matchBunVer = cmakelists.match(/^set\(Bun_VERSION\s+"(.+)"\)/m);
if (!matchBunVer) abort('Could not find Bun_VERSION in CMakeLists.txt');

const BUN_VERSION = matchBunVer![1].trim();

const bunTsPath = path.resolve(import.meta.dir, '../src/modules/bun.ts');
const bunTs = Bun.file(bunTsPath);
if (!await bunTs.exists()) abort('bun.ts source file not found at', bunTsPath);

const bunTsContent = await bunTs.text();
const bunTsContentNew = bunTsContent.replace(
    /^export const version = '.+' satisfies typeof Bun\.version;$/m,
    `export const version = '${BUN_VERSION}' satisfies typeof Bun.version;`
);
if (bunTsContentNew !== bunTsContent) console.info('Updated Bun.version polyfill to', BUN_VERSION);

const git = Bun.spawnSync({ cmd: ['git', 'rev-parse', 'HEAD'] });
if (!git.success) abort('Could not get git HEAD commit hash');
const BUN_REVISION = git.stdout.toString('utf8').trim();

const bunTsContentNewer = bunTsContentNew.replace(
    /^export const revision = '.+' satisfies typeof Bun\.revision;$/m,
    `export const revision = '${BUN_REVISION}' satisfies typeof Bun.revision;`
);
if (bunTsContentNewer !== bunTsContentNew) console.info('Updated Bun.revision polyfill to', BUN_REVISION);

Bun.write(bunTs, bunTsContentNewer);

const processTsPath = path.resolve(import.meta.dir, '../src/global/process.ts');
const processTsFile = Bun.file(processTsPath);
if (!await processTsFile.exists()) abort('process.ts source file not found at', processTsPath);
const processTsContent = await processTsFile.text();

const genVerListPath = path.resolve(import.meta.dir, '../../../src/generated_versions_list.zig');
const genVerListFile = Bun.file(genVerListPath);
if (!await genVerListFile.exists()) abort('generated_versions_list.zig source file not found at', genVerListPath);

const codegenLines: string[] = [];
const genVerList = await genVerListFile.text();
for (const match of genVerList.matchAll(/^pub const (?<name>\w+) = "(?<version>.+)";$/gm)) {
    const { name, version } = match.groups!;
    if (name === 'zlib') continue;
    codegenLines.push(`    process.versions.${name} = '${version}' satisfies Process['versions'][string];`);
}

const buildZigPath = path.resolve(import.meta.dir, '../../../build.zig');
const buildZigFile = Bun.file(buildZigPath);
if (!await buildZigFile.exists()) abort('build.zig source file not found at', buildZigPath);
const buildZig = await buildZigFile.text();
const matchZigVer = buildZig.match(/^const recommended_zig_version = "(.+)";$/m);
if (!matchZigVer) abort('Could not find recommended_zig_version in build.zig');
const ZIG_VERSION = matchZigVer![1].trim();

Bun.write(processTsFile, processTsContent.replace(
    /\/\*\*\s*@start_generated_code\s*\*\/[^]*?\/\*\*\s*@end_generated_code\s*\*\//,
    `/** @start_generated_code */
${codegenLines.join('\n')}
    process.versions.zig = '${ZIG_VERSION}' satisfies Process['versions'][string];
    process.versions.bun = '${BUN_VERSION}' satisfies Process['versions'][string];
    Reflect.set(process, 'revision', '${BUN_REVISION}' satisfies Process['revision']);
    /** @end_generated_code */`
));
