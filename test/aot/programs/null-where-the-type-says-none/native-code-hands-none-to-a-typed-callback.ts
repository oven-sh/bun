interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown) { try { console.log(what, String(run())); } catch (error) { console.log(what, (error as Error).constructor.name); } }
const origin: Point = { x: 1, y: 2 };
const mixed = [origin, null, undefined, { x: 3, y: 4 }] as Point[];
attempt("for each", () => { const seen: string[] = []; mixed.forEach((point: Point) => seen.push(point === null ? "null" : point === undefined ? "undefined" : "x" + point.x)); return seen.join(); });
attempt("map", () => mixed.map((point: Point) => point?.x ?? "none").join());
attempt("map throws", () => mixed.map((point: Point) => point.x).join());
attempt("filter", () => mixed.filter((point: Point) => point != null).length);
attempt("find", () => mixed.find((point: Point) => point == null) === null);
attempt("reduce", () => mixed.reduce((sum: number, point: Point) => sum + (point ? point.x : 100), 0));
attempt("sort", () => (["b", undefined, "a", null] as string[]).sort((left: string, right: string) => String(left).localeCompare(String(right))).join("|"));
attempt("replace", () => "abc".replace(/(x)?b/, (all: string, group: string) => all + (group === undefined) + typeof group));
