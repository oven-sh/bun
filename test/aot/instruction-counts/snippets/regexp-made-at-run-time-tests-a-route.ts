// tests a path against a router's pattern that is made at run time
const operations = 100;
let name = "";
const codes = [117, 115, 101, 114, 115];
for (let i = 0; i < codes.length; i++) name += String.fromCharCode(codes[i] + (Date.now() < 0 ? 1 : 0));
const route = new RegExp("^\\/(?:async\\/([^/]+)$()|" + name + "\\/([^/]+)\\/posts\\/([^/]+)$())");
const paths: string[] = [];
for (let i = 0; i < operations; i++) paths.push("/users/" + (40 + i) + "/posts/" + (i % 10));
let total = 0;

kernel: {
  let matched = 0;
  for (let i = 0; i < paths.length; i++) if (route.test(paths[i])) matched++;
  total += matched;
}

console.log(total);
