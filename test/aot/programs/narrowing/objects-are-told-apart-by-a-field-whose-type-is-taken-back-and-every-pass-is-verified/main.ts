// Two files spell one shape with other texts under one name. A literal lists a text that was read from one of three kinds of object, and a switch elsewhere tells what was made from a record by a text that never gets there.
import { toBell } from "./bells";

type Drum = { tone: "deep" | "mid"; skin: string };

function makeFlat(shine: number): { tone: "flat"; shine: number } {
  return { tone: "flat", shine };
}
function makeDrum(tone: "deep" | "mid", skin: string): Drum {
  return { tone, skin };
}
function play(it: { tone: "low" | "mid" | "high" | "flat"; rings: number } | Drum | undefined): unknown {
  if (!it) return "none";
  switch (it.tone) {
    case "deep":
      return it.skin;
    case "high":
      return it.rings;
    default:
      return "other";
  }
}

const given: any = JSON.parse('["deep", "mid"]');
const all = [
  toBell({ tone: "low", depth: 1 }, 1),
  toBell({ hush: 1 }, 1),
  toBell({ tone: "high", shine: 1 }, 2),
  toBell({ tone: "mid", shine: 2 }, 3),
  toBell(makeFlat(3) as any, 4),
  makeDrum(given[0], "a"),
  makeDrum(given[1], "b"),
];
for (const it of all) console.log(play(it));
