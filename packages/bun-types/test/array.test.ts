async function* listReleases() {
  for (let page = 1; ; page++) {
    const response = await fetch(
      `https://api.github.com/repos/oven-sh/bun/releases?page=${page}`,
    );
    const releases = (await response.json()) as Array<{ data: string }>;
    if (!releases.length) {
      break;
    }
    for (const release of releases) {
      yield release;
    }
  }
}

await Array.fromAsync(listReleases());

export {};
