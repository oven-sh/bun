// JSON.parse that fails inside `try { } catch { }`: whether or not the handler looks at the error, the program behaves as in plain Bun.
const anything: any = { json: JSON };
function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
function parsedOr<T>(text: string, otherwise: T): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    return otherwise;
  }
}
function parse(text: string): unknown {
  return JSON.parse(text);
}
function parseDeeper(depth: number, text: string): unknown {
  const parsed = depth ? parseDeeper(depth - 1, text) : parse(text);
  return parsed === undefined ? null : parsed;
}
function parsesFurtherUp(text: string): boolean {
  try {
    parseDeeper(4, text);
    return true;
  } catch {
    return false;
  }
}
function describe(error: unknown): string {
  const e = error as Error;
  return [e instanceof SyntaxError, e.name, e.message, typeof e.stack, Object.keys(e).length].join(" | ");
}
function messageOf(text: string): string {
  try {
    JSON.parse(text);
    return "none";
  } catch (error) {
    return describe(error);
  }
}
function messageFurtherUp(text: string): string {
  try {
    parseDeeper(3, text);
    return "none";
  } catch (error) {
    return describe(error);
  }
}
let cleaned = 0;
function withFinally(text: string): unknown {
  try {
    return parse(text);
  } finally {
    cleaned++;
  }
}
function ignoredBehindFinally(text: string): boolean {
  try {
    withFinally(text);
    return true;
  } catch {
    return false;
  }
}
function looksBehindFinally(text: string): string {
  try {
    withFinally(text);
    return "none";
  } catch (error) {
    return describe(error);
  }
}
function innerLooksOuterIgnores(text: string): string {
  let seen = "nothing";
  try {
    try {
      JSON.parse(text);
    } catch (error) {
      seen = describe(error);
      throw error;
    }
  } catch {
    cleaned++;
  }
  return seen;
}
function withReviver(text: string): boolean {
  try {
    JSON.parse(text, (key, value) => value);
    return true;
  } catch {
    return false;
  }
}
function reviverThrows(text: string): boolean {
  try {
    JSON.parse(text, () => {
      throw new RangeError("from the reviver");
    });
    return true;
  } catch {
    return false;
  }
}
function argumentThrows(): boolean {
  try {
    JSON.parse({ toString() { throw new RangeError("from toString"); } } as unknown as string);
    return true;
  } catch {
    return false;
  }
}
function throughAnything(text: string): boolean {
  try {
    anything.json.parse(text);
    return true;
  } catch {
    return false;
  }
}
async function asyncIgnores(text: string): Promise<boolean> {
  await null;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
async function asyncRejects(text: string): Promise<unknown> {
  await null;
  return JSON.parse(text);
}
async function main(): Promise<void> {
  for (const text of ['{"a":1}', "{", "", "[1,]", "€{", '"€"', "nul"]) {
    console.log([parses(text), JSON.stringify(parsedOr(text, "otherwise")), parsesFurtherUp(text), ignoredBehindFinally(text), withReviver(text), reviverThrows(text), throughAnything(text)].join());
    console.log(messageOf(text));
    console.log(messageFurtherUp(text));
    console.log(looksBehindFinally(text));
    console.log(innerLooksOuterIgnores(text));
    console.log(await asyncIgnores(text), await asyncRejects(text).then(value => JSON.stringify(value), describe));
  }
  console.log(argumentThrows());
  console.log(["{", "1", "[", "2"].map(text => parses(text)).join());
  let good = 0;
  for (let i = 0; i < 20000; i++) {
    if (parses(i % 3 ? "{" : "{}")) good++;
    if (parsesFurtherUp(i % 5 ? "[1," : "[1]")) good++;
  }
  console.log(good, cleaned);
}
main();
