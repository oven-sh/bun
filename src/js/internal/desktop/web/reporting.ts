const idl = require("internal/desktop/web/idl");

const { scope, string, usv } = idl;
const unsigned = (value: any) => value >>> 0;

const SecurityPolicyViolationEvent = idl.eventClass("SecurityPolicyViolationEvent", {
  documentURI: [usv, ""],
  referrer: [usv, ""],
  blockedURI: [usv, ""],
  violatedDirective: [string, ""],
  effectiveDirective: [string, ""],
  originalPolicy: [string, ""],
  sourceFile: [usv, ""],
  sample: [string, ""],
  disposition: [value => idl.oneOf(value, ["enforce", "report"]), "enforce"],
  statusCode: [value => value & 0xffff, 0],
  lineNumber: [unsigned, 0],
  columnNumber: [unsigned, 0],
});

type Report = { type: string; url: string; body: object };
const reports: Report[] = [];
const observers = new Set<(report: Report) => void>();

class ReportingObserver {
  #callback: Function;
  #types: string[];
  #isBuffered: boolean;
  #queue: Report[] = [];

  constructor(callback: Function, options: any = undefined) {
    this.#callback = idl.callable(callback);
    const { buffered, types = [] } = idl.dictionary(options);
    this.#isBuffered = !!buffered;
    this.#types = idl.sequence(types).map(string);
  }

  #add = (report: Report) => {
    if (this.#types.length > 0 && !this.#types.includes(report.type)) return;
    if (this.#queue.push(report) > 1) return;
    idl.queueTask(() => {
      try {
        if (this.#queue.length > 0) (this.#callback as any).$call(this, this.#queue.splice(0), this);
      } catch (thrown) {
        scope.report(thrown);
      }
    });
  };

  observe() {
    observers.$add(this.#add);
    if (this.#isBuffered) reports.forEach(this.#add);
    this.#isBuffered = false;
  }
  disconnect() {
    observers.$delete(this.#add);
  }
  takeRecords() {
    return this.#queue.splice(0);
  }
}
idl.expose(ReportingObserver);

const withJson = <T extends object>(values: T): T =>
  Object.defineProperty({ ...values }, "toJSON", { value: () => values });

function deliver(type: string, body: any, element?: any) {
  if (type === "csp-violation") {
    const target = element?.isConnected ? element : (scope.global.document ?? scope.global);
    const init = { ...body, bubbles: true, composed: true };
    idl.dispatchInTask(target, new SecurityPolicyViolationEvent("securitypolicyviolation", init));
    const { blockedURI: blockedURL, documentURI: documentURL, violatedDirective: _violatedDirective, ...rest } = body;
    const isLocated = rest.sourceFile !== "";
    body = {
      documentURL,
      blockedURL,
      ...rest,
      ...(!isLocated && { sourceFile: null, lineNumber: null, columnNumber: null }),
    };
  }
  const report = withJson({ type, url: scope.env.url.split("#")[0], body: withJson(body) });
  if (reports.push(report) > 100) reports.shift();
  observers.$forEach(add => add(report));
}

export default { ReportingObserver, SecurityPolicyViolationEvent, deliver };
