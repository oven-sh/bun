// Reference: bun build --compile
// Build prints: 5 x warn: TS100098: This reads "data.txt", but the executable has no file at that path. Embed it with --asset data.txt
import fs from "node:fs";
import { join } from "node:path";
const here = import.meta.dirname;
const seen = [];
let early = join(here, "data.txt");
seen.push(fs.existsSync(early));
early = join(here, "absent.txt");
let branch = join(here, "data.txt");
if (process.argv.length > 9) branch = join(here, "absent.txt");
seen.push(fs.existsSync(branch));
let hoisted = join(here, "data.txt");
seen.push(readsHoisted());
hoisted = join(here, "absent.txt");
function readsHoisted() {
  return fs.existsSync(hoisted);
}
let back = join(here, "data.txt");
back = join(here, "absent.txt");
back = join(here, "data.txt");
seen.push(fs.existsSync(back));
let kept = join(here, "data.txt");
const old = kept;
kept = join(here, "absent.txt");
seen.push(fs.existsSync(old), fs.existsSync(kept));
console.log(seen.join());
