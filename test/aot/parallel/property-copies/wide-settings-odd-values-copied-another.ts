// A wide settings object: many optional fields, many names that its type does not list, and a value or two of another type than declared.
type Settings = {
  setting0?: number;
  setting1?: string;
  setting2?: boolean;
  setting3?: string[];
  setting4?: number;
  setting5?: string;
  setting6?: boolean;
  setting7?: string[];
  setting8?: number;
  setting9?: string;
  setting10?: boolean;
  setting11?: string[];
  setting12?: number;
  setting13?: string;
  setting14?: boolean;
  setting15?: string[];
  setting16?: number;
  setting17?: string;
  setting18?: boolean;
  setting19?: string[];
  setting20?: number;
  setting21?: string;
  setting22?: boolean;
  setting23?: string[];
  setting24?: number;
  setting25?: string;
  setting26?: boolean;
  setting27?: string[];
  setting28?: number;
  setting29?: string;
  setting30?: boolean;
  setting31?: string[];
  setting32?: number;
  setting33?: string;
  setting34?: boolean;
  setting35?: string[];
  setting36?: number;
  setting37?: string;
  setting38?: boolean;
  setting39?: string[];
  setting40?: number;
  setting41?: string;
  setting42?: boolean;
  setting43?: string[];
  setting44?: number;
  setting45?: string;
  setting46?: boolean;
  setting47?: string[];
  setting48?: number;
  setting49?: string;
  setting50?: boolean;
  setting51?: string[];
  setting52?: number;
  setting53?: string;
  setting54?: boolean;
  setting55?: string[];
  setting56?: number;
  setting57?: string;
  setting58?: boolean;
  setting59?: string[];
  setting60?: number;
  setting61?: string;
  setting62?: boolean;
  setting63?: string[];
  setting64?: number;
  setting65?: string;
  setting66?: boolean;
  setting67?: string[];
  setting68?: number;
  setting69?: string;
  setting70?: boolean;
  setting71?: string[];
  setting72?: number;
  setting73?: string;
  setting74?: boolean;
  setting75?: string[];
  setting76?: number;
  setting77?: string;
  setting78?: boolean;
  setting79?: string[];
};
function read(seed: number, odd: boolean, unlisted: boolean): Settings {
  const text: Record<string, unknown> = {};
  for (let index = 0; index < 80; index += 2) text["setting" + index] = index % 4 === 0 ? seed + index : seed % 2 === 0;
  if (unlisted) for (let index = 0; index < 6; index++) text["unlisted" + index] = "u" + index;
  if (odd) { text.setting8 = "not a number"; text.setting40 = [1]; }
  return JSON.parse(JSON.stringify(text)) as Settings;
}
const defaults: Settings = { setting1: "one", setting3: ["a"], setting5: "five", setting0: 0 };
function merged(parsed: Settings): Settings { return { ...defaults, ...parsed }; }
function copied(settings: Settings): Settings { return { ...settings }; }
function changed(settings: Settings, value: number): Settings { return { ...settings, setting4: value }; }
type More = Settings & { more: number; note?: string };
function toMore(settings: Settings, more: number): More { return { ...settings, more }; }
function fromMore({ more, note, ...settings }: More): Settings { return settings; }
function describe(value: object): string { const keys = Object.keys(value); return keys.length + " " + keys.slice(0, 6).join(",") + " .. " + keys.slice(-3).join(",") + " " + JSON.stringify((value as Settings).setting8) + " " + JSON.stringify((value as Settings).setting4); }
const rounds = Number(process.argv[2] ?? 3);
let sum = 0;
for (let round = 0; round < rounds; round++) {
  for (let seed = 0; seed < 4; seed++) {
    const a = merged(read(seed, (seed & 1) === 1, (seed & 2) === 2)); const b = toMore(a, seed); const c = fromMore(b); const d = toMore(changed(c, round), round);
    sum += Object.keys(d).length + (typeof d.setting8 === "number" ? d.setting8 : 1);
    if (round < 2) console.log(round, seed, describe(a), "|", describe(b), "|", describe(c), "|", describe(d));
  }
}
console.log(sum);
