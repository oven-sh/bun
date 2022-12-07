import { expectType } from "tsd";

async function* listReleases() {
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/oven-sh/bun/releases?page=${page}`,
    );
    const releases: { data: string }[] = await response.json();
    if (!releases.length) {
      break;
    }
    for (const release of releases) {
      yield release;
    }
  }
}

const releases = await Array.fromAsync(listReleases());
expectType<{ data: string }[]>(releases);
