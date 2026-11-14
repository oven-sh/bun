import { nextTurns } from "../host.ts";
let kept: unknown;
const chunks: string[] = [0, 1].map(n => ("1" + n + ":" + "[\"$\",\"tr\",\"meadow-30\",{\"className\":\"odd\",\"id\":\"meadow-30\",\"children\":[[\"$\",\"td\",null,{\"children\":30}],[\"$\",\"td\",null,{\"children\":[[\"$\",\"a\",null,{\"href\":\"/products/meadow-30\",\"children\":\"Rustic Rug 30\"}],[\"$\",\"ul\",null,{\"className\":\"tags\",\"children\":[[\"$\",\"li\",\"new\",{\"className\":\"tag tag-new\",\"children\":\"new\"}],[\"$\",\"li\",\"sale\",{\"className\":\"tag tag-sale\",\"children\":\"sale\"}],[\"$\",\"li\",\"small\",{\"className\":\"tag tag-small\",\"children\":\"small\"}]]}]]}],[\"$\",\"td\",null,{\"children\":[\"$\",\"span\",null,{\"className\":\"price\",\"children\":[[\"$\",\"span\",null,{\"className\":\"currency\",\"children\":\"EUR\"}],\" \",\"146.19\"]}]}],[\"$\",\"td\",null,{\"children\":[\"$\",\"span\",null,{\"className\":\"rating\",\"title\":\"2.5 of 5\",\"children\":[\"***\",\"--\",\" \",[\"$\",\"small\",null,{\"children\":[\"(\",188,\")\"]}]]}]}],[\"$\",\"td\",null,{\"children\":[\"$\",\"span\",null,{\"className\":\"dimensions\",\"children\":[79,\" x \",32,\" x \",10,\" cm\"]}]}],[\"$\",\"td\",null,{\"children\":[\"$\",\"span\",null,{\"className\":\"seller\",\"children\":[[\"$\",\"a\",null,{\"href\":\"/sellers/Seller%200\",\"children\":\"Seller 0\"}],\" \",[\"$\",\"abbr\",null,{\"title\":\"country\",\"children\":\"IN\"}]]}]}],[\"$\",\"td\",null,{\"children\":[\"$\",\"span\",null,{\"className\":\"stock\",\"children\":\"in stock\"}]}],[\"$\",\"td\",null,{\"children\":[\"$\",\"$L15\",null,{\"id\":\"meadow-30\",\"name\":\"Rustic Rug 30\",\"isAvailable\":true}]}]]}]" + "\n").repeat(3));
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = JSON.stringify([1, chunks[i & 1]]);
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
