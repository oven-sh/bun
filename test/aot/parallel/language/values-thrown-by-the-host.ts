// What a built-in of the host throws need not be an instance of the class Error as the engine makes them: a DOMException, a ResolveMessage. Whoever catches it reads it like any object.
function describe(title: string, action: () => unknown): void {
  try {
    console.log(title, "returned", typeof action());
  } catch (error) {
    if (typeof error !== "object" || error === null) {
      console.log(title, "threw", typeof error, String(error));
      return;
    }
    const caught = error as Error;
    console.log(title, caught.constructor.name, caught instanceof Error, caught.name, typeof caught.message, String(caught.message).length > 0, typeof caught.stack, Object.prototype.toString.call(caught));
  }
}
describe("structuredClone of a function", () => structuredClone(() => 1));
describe("atob of no base64", () => atob("*"));
describe("an aborted signal", () => AbortSignal.abort().throwIfAborted());
describe("a signal aborted with a reason", () => AbortSignal.abort("why").throwIfAborted());
describe("no URL", () => new URL("no url"));
describe("a module that is not there", () => import.meta.require("./not-there-at-all"));
describe("a label that is no encoding", () => new TextDecoder("no-such-label"));
describe("JSON.parse", () => JSON.parse("{"));
describe("a call of null", () => (null as unknown as () => void)());

function code(action: () => unknown): unknown {
  try { action(); return "none"; } catch (error) { return (error as { code?: unknown }).code; }
}
console.log(code(() => structuredClone(() => 1)), code(() => atob("*")), code(() => JSON.parse("{")));
