#!/usr/bin/env bun

let result = await fetch(`https://registry.npmjs.org/${Bun.argv[2]}`);
result = await result.json();
result = result.repository.url;
result = result.replace("git:", "https:");
result = result.replace("git+", "");
result = result.replace("ssh://git@", "https://");
console.log(result);

export {};
