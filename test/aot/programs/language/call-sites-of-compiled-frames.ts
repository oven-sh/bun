// What Error.prepareStackTrace call sites and Error.captureStackTrace report for compiled frames, and for frames of other kinds between them.
import path from "node:path";

const errorClass: any = Error;
// The sites a function below gets are used twice, because plain Bun's transpiler puts a constant that is used once in the place of its use,
// and `return captureSites()` is a tail call, which drops the frame of its caller.
let lastSites: any;

function readSites(read: () => any): any {
  const earlier = errorClass.prepareStackTrace;
  errorClass.prepareStackTrace = (_error: unknown, sites: any[]) => sites;
  const sites = read();
  errorClass.prepareStackTrace = earlier;
  lastSites = sites;
  return sites;
}

function captureSites(): any {
  const sites = readSites(() => new Error("site").stack);
  lastSites = sites;
  return sites;
}

function captureAbove(fn: any): any {
  const sites = readSites(() => {
    const target: any = {};
    errorClass.captureStackTrace(target, fn);
    return target.stack;
  });
  lastSites = sites;
  return sites;
}

function showFile(file: any): any {
  if (typeof file !== "string") return file;
  return /^\[source:\d+\]$/.test(file) ? "[source]" : path.basename(file);
}

const programFile = showFile(captureSites()[0].getFileName());

function sitesInProgram(sites: any[]): any[] {
  const files = sites.map(site => showFile(site.getFileName()));
  return sites.slice(0, files.lastIndexOf(programFile) + 1);
}

// Two columns are left out. A call site of plain Bun puts a `new` expression where it starts, its `stack` string where the callee starts, as compiled code does in both.
// A text given to `new Function` has no source map in plain Bun, so a call in it is put behind its callee.
function showSite(site: any, callee: any): string {
  const isNewExpression = !!callee && callee.isConstructor();
  const isInEvaluatedText = site.getFunctionName() === "anonymous";
  return [
    site.getFunctionName(),
    site.getTypeName(),
    site.getMethodName(),
    showFile(site.getFileName()),
    site.getLineNumber(),
    isNewExpression || isInEvaluatedText ? "-" : site.getColumnNumber(),
    site.isConstructor(),
    site.isNative(),
    site.isToplevel(),
    site.isAsync(),
    site.isEval(),
  ].join(" | ");
}

function report(label: string, sites: any[]): void {
  console.log(label);
  const shown = sitesInProgram(sites);
  for (let index = 0; index < shown.length; index++) console.log("  " + showSite(shown[index], shown[index - 1]));
}

function reportNames(label: string, sites: any[]): void {
  console.log(label + ": " + sitesInProgram(sites).map(site => site.getFunctionName()).join(" < "));
}

function plainFunction(): any {
  const sites = captureSites();
  lastSites = sites;
  return sites;
}

const arrowInVariable = (): any => {
  const sites = captureSites();
  lastSites = sites;
  return sites;
};

class Shape {
  sites: any;
  constructor() {
    this.sites = captureSites();
  }
  method(): any {
    const sites = captureSites();
    lastSites = sites;
    return sites;
  }
  static staticMethod(): any {
    const sites = captureSites();
    lastSites = sites;
    return sites;
  }
  get value(): any {
    const sites = captureSites();
    lastSites = sites;
    return sites;
  }
  async asyncMethod(): Promise<any> {
    await null;
    const sites = captureSites();
    lastSites = sites;
    return sites;
  }
}

function renamedAtRunTime(): any {
  const sites = captureSites();
  lastSites = sites;
  return sites;
}
Object.defineProperty(renamedAtRunTime, "name", { value: "nameSetAtRunTime" });

async function asyncFunction(): Promise<any> {
  await null;
  const sites = captureSites();
  lastSites = sites;
  return sites;
}

async function asyncCaller(): Promise<any> {
  const sites = await asyncFunction();
  lastSites = sites;
  return sites;
}

async function asyncMethodCaller(): Promise<any> {
  const sites = await new Shape().asyncMethod();
  lastSites = sites;
  return sites;
}

report("module top level", captureSites());
report("plain function", plainFunction());
report("arrow in a variable", arrowInVariable());
report("method", new Shape().method());
report("static method", Shape.staticMethod());
report("getter", new Shape().value);
report("new", new Shape().sites);
report("name redefined at run time", renamedAtRunTime());
report(
  "callback of Array.prototype.map",
  [1].map(() => {
    const sites = captureSites();
    lastSites = sites;
    return sites;
  })[0],
);

function outerFrame(): any {
  const sites = middleFrame();
  lastSites = sites;
  return sites;
}
function middleFrame(): any {
  const sites = innerFrame();
  lastSites = sites;
  return sites;
}
function innerFrame(): any {
  const sites = captureAbove(outerFrame);
  lastSites = sites;
  return sites;
}
function callsOuterFrame(): any {
  const sites = outerFrame();
  lastSites = sites;
  return sites;
}
reportNames("captureStackTrace above a function three frames up", callsOuterFrame());

function captureAboveClass(): any {
  const sites = captureAbove(CapturedClass);
  lastSites = sites;
  return sites;
}
class CapturedClass {
  sites: any;
  constructor() {
    this.sites = captureAboveClass();
  }
}
function constructsCapturedClass(): any {
  const sites = new CapturedClass().sites;
  lastSites = sites;
  return sites;
}
reportNames("captureStackTrace above a class constructor", constructsCapturedClass());

function boundTarget(): any {
  const sites = captureAbove(boundFunction);
  lastSites = sites;
  return sites;
}
const boundFunction = boundTarget.bind(null);
function callsBoundFunction(): any {
  const sites = boundFunction();
  lastSites = sites;
  return sites;
}
reportNames("captureStackTrace above a bound function", callsBoundFunction());

function neverCalled(): void {}
function capturesAboveNeverCalled(): any {
  const sites = captureAbove(neverCalled);
  lastSites = sites;
  return sites;
}
reportNames("captureStackTrace above a function never called", capturesAboveNeverCalled());

const notCompiled = new Function("callback", "const sites = callback(); return sites;");
function calledByNotCompiled(): any {
  const sites = captureSites();
  lastSites = sites;
  return sites;
}
function callsNotCompiled(): any {
  const sites = notCompiled(calledByNotCompiled);
  lastSites = sites;
  return sites;
}
report("function not compiled between compiled frames", callsNotCompiled());

function captureWithoutFrames(): string {
  const earlierLimit = errorClass.stackTraceLimit;
  errorClass.stackTraceLimit = 0;
  const sites = captureSites();
  errorClass.stackTraceLimit = earlierLimit;
  return Array.isArray(sites) ? "sites: " + sites.length : typeof sites;
}
console.log("Error.stackTraceLimit = 0: " + captureWithoutFrames());

let sitesInStreamStart: any = [];
new (globalThis as any).ReadableStream({
  start() {
    sitesInStreamStart = captureSites();
  },
});
reportNames("callback of a private built-in", sitesInStreamStart);
console.log(
  "private built-in listed: " +
    sitesInProgram(sitesInStreamStart).some(site => site.getFunctionName() === "setupReadableStreamDefaultController"),
);

asyncCaller()
  .then(sites => {
    report("async function after await", sites);
    return asyncMethodCaller();
  })
  .then(sites => report("async method after await", sites));
