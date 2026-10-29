// A process that is killed (a timeout, a memory guard, Ctrl-C, the kernel) removes none of its temporary folders, and those of
// the compiler's tests hold executables of hundreds of megabytes. Where the temporary directory is memory, that is memory.
//
// Each process lists the folders it makes in a file of its own, in `bun-test-temporary-folders` beside them. A process that
// makes its first folder removes what the lists of dead processes name. A process that has removed all its folders takes its
// list along when it exits.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

const nameOfLists = "bun-test-temporary-folders";
// A process may still read what a child of its has made and left.
const graceOfDeadProcess = 15 * 60_000;
const isLinux = process.platform === "linux";

/** What tells a process from a later one with the same number. Nothing for a process that is gone. */
function startOf(pid: number): string | undefined {
  try {
    if (isLinux) {
      const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
      // The name of the program may hold blanks and brackets. The time of the start is the 22nd field, the state the 3rd.
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    }
    process.kill(pid, 0);
    return "0";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM" ? "0" : undefined;
  }
}

/** A process in another container has a number that means nothing here. */
function namespaceOfProcesses(): string {
  try {
    return isLinux ? readlinkSync("/proc/self/ns/pid").replace(/\D/g, "") : "0";
  } catch {
    return "0";
  }
}

function removeFoldersOfDeadProcesses(lists: string, namespace: string) {
  for (const name of readdirSync(lists)) {
    try {
      const list = join(lists, name);
      const [pid, start, itsNamespace] = name.split("-");
      if (itsNamespace !== namespace || Date.now() - statSync(list).mtimeMs < graceOfDeadProcess) continue;
      if (startOf(Number(pid)) === start) continue;
      for (const folder of readFileSync(list, "utf8").split("\n")) {
        if (folder && dirname(folder) === dirname(lists)) rmSync(folder, { recursive: true, force: true });
      }
      rmSync(list, { force: true });
    } catch {
      // Another process is removing the same, or the folder belongs to another user.
    }
  }
}

const listsOfThisProcess = new Map<string, { file: number; path: string; folders: string[] }>();

/** Says that this process has made `folder`, which lies directly in a temporary directory. Answers `folder`. */
export function ownTemporaryFolder(folder: string): string {
  try {
    const lists = join(dirname(folder), nameOfLists);
    let list = listsOfThisProcess.get(lists);
    if (!list) {
      mkdirSync(lists, { recursive: true });
      const namespace = namespaceOfProcesses();
      removeFoldersOfDeadProcesses(lists, namespace);
      const path = join(lists, `${process.pid}-${startOf(process.pid)}-${namespace}`);
      list = { file: openSync(path, "a"), path, folders: [] };
      if (!listsOfThisProcess.size) process.on("exit", forgetListsOfRemovedFolders);
      listsOfThisProcess.set(lists, list);
    }
    writeSync(list.file, folder + "\n");
    list.folders.push(folder);
  } catch {
    // A temporary directory that cannot be written to fails the test that needs it, with a better message.
  }
  return folder;
}

function forgetListsOfRemovedFolders() {
  for (const { file, path, folders } of listsOfThisProcess.values()) {
    closeSync(file);
    if (!folders.some(folder => existsSync(folder))) rmSync(path, { force: true });
  }
}
