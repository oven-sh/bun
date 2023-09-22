// @ts-check
import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const abort = (/** @type {unknown[]} */ ...msg) => {
    console.error(...msg);
    process.exit(1);
}
// Actually tried to make it node-compatible just in case, but node literally corrupts the zip file for no reason. (???)
if (!process.isBun) abort('This script must run in Bun.');

const unzip = spawnSync('command', ['-v', 'unzip'], { shell: true });
if (unzip.status !== 0) abort('unzip is required to run this script.');

let lldbName = 'lldb';
try {
    spawnSync('lldb', ['-h']);
} catch {
    try {
        spawnSync('lldb-16', ['-h']);
        lldbName = 'lldb-16';
    } catch {
        abort('lldb not found in PATH, you can install it with' + getLLDBInstallMessage());
    }
}

const execPath = process.execPath //: path.join(process.env.BUN_INSTALL ?? '', 'bin', 'bun');
const dlPath = path.join(path.dirname(execPath), 'bun-profile');
const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
const target = `${process.platform}-${arch}-profile`;
const version = Bun.version //: execSync(`${execPath} -v`).toString().trim();
const url = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-${target}.zip`;

InstallBuild: try {
    if (fs.existsSync(dlPath)) {
        console.warn('A bun-profile build is already installed, skipping download.');
        break InstallBuild;
    }
    const start = performance.now();
    const fetched = await fetch(url);
    if (fetched.status === 404) abort(
        'Matching bun-profile build not found (404).\n' +
        'Are you on a canary build? Canary builds don\'t have profile builds, please try a release build of Bun.'
    );
    if (!fetched.ok || !fetched.body) {
        abort(`Failed to download bun-profile build: ${fetched.status} - ${fetched.statusText}`);
        break InstallBuild; // For intellisense's sake, but this is unreachable.
    }
    const wstream = fs.createWriteStream(`./bun-${target}.zip`);
    const reader = fetched.body.getReader();
    const total = Number(fetched.headers.get('content-length'));
    if (!Number.isSafeInteger(total)) abort('Error: Malformed response headers for safe download.');
    let read = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (!value) break;
        wstream.write(value);
        if (done) break;
        process.stdout.write(`\rDownloading bun-${target}... [${read += value.byteLength}/${total}]`);
    }
    wstream.end();
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns));
    try {
        spawnSync('unzip', [`./bun-${target}.zip`]);
    } catch (e) {
        const err = /** @type {Error} */(e);
        abort('Failed to unzip downloaded bun build.', err.message ?? err);
    }
    fs.unlinkSync(`./bun-${target}.zip`);
    fs.renameSync(`./bun-${target}/bun-profile`, dlPath);
    fs.rmdirSync(`./bun-${target}`);
    console.log('\rdownload finished in', performance.now() - start, 'ms');
} catch (e) {
    const err = /** @type {Error} */(e);
    abort(`failed to install profile build from ${url}\nerror:`, err.message ?? err);
}

const SEGFAULT_MARKER = '@bun-crash-dump_segfault_marker';
const lldb = spawnSync(lldbName, [
    '-Q', '-x', '-b', '-o', 'run', '-k', 'bt all', '-k', `shell echo "${SEGFAULT_MARKER}"`, '-k', 'q', '--', dlPath, ...process.argv.slice(2)
]);

const filename = `./bun-${target.slice(0, -8)}_${new Date().toISOString().replaceAll(':', '-')}_lldb.crashlog`;
const wstream = fs.createWriteStream(filename);

if (lldb.status !== 0) abort('lldb exited with non-zero status code:', lldb.status);

const stderr = lldb.stderr.toString('utf8');
const stdout = lldb.stdout.toString('utf8');
wstream.write(
    `bun v${version} ${target}\nSTDERR:\n` +
    stderr + '\nSTDOUT:\n' +
    stdout + '\n'
);

process.on('exit', () => {
    wstream.end();
    //fs.unlinkSync(dlPath);
    console.log(
        `lldb logs saved to: ${path.resolve(filename)}\n` +
        'Share that file with the bun developers to assist in debugging this potential crash.'
    );
    if (!stdout.includes(SEGFAULT_MARKER)) {
        console.error('[!] WARNING: Could not detect a segfault in the LLDB output, please review the output file and check if Bun really crashed.');
    }
    process.exit(0);
});

// Feel free to PR more package managers if yours is missing
function getLLDBInstallMessage() {
    const opts = { shell: true };
    const { platform } = process;
    if (platform === 'linux') {
        const brew = spawnSync('command', ['-v', 'brew'], opts);
        if (brew.status === 0) return ': brew install lldb';
        const apt = spawnSync('command', ['-v', 'apt'], opts);
        if (apt.status === 0) return ': apt install lldb';
        const aptget = spawnSync('command', ['-v', 'apt-get'], opts);
        if (aptget.status === 0) return ': apt-get install lldb';
        const pkg = spawnSync('command', ['-v', 'pkg'], opts);
        if (pkg.status === 0) return ': pkg install lldb';
        const pacman = spawnSync('command', ['-v', 'pacman'], opts);
        if (pacman.status === 0) return ': pacman -S lldb';
        const emerge = spawnSync('command', ['-v', 'emerge'], opts);
        if (emerge.status === 0) return ': emerge dev-util/lldb';
        const yum = spawnSync('command', ['-v', 'yum'], opts);
        if (yum.status === 0) return ': yum install llvm-toolset-7';
        const apk = spawnSync('command', ['-v', 'apk'], opts);
        if (apk.status === 0) return ': apk add lldb';
        const dnf = spawnSync('command', ['-v', 'dnf'], opts);
        if (dnf.status === 0) return ': dnf install lldb';
    }
    else if (platform === 'win32') return ': winget install LLVM';
    return ' your system\'s package manager. The package name is likely "lldb" or "llvm".';
}
