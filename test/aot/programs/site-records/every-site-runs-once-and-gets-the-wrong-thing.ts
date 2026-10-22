// Code that runs once: each function here is called a single time, and what arrives is not what its types promise. There is no earlier call that could have taught the site anything.
class Config {
  host = "localhost";
  port = 80;
  secure = false;
  address(): string {
    return (this.secure ? "https://" : "http://") + this.host + ":" + this.port;
  }
}
class Mirror {
  secure = "yes";
  port = "eighty";
  host = 127;
  address(): string {
    return "mirror of " + this.host;
  }
}

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function wrong<T>(value: unknown): T {
  return value as T;
}

function readFromMirror(config: Config): unknown {
  return config.host;
}
function readFromParsed(config: Config): unknown {
  return config.port;
}
function readFromNull(config: Config): unknown {
  return config.secure;
}
function readFromNumber(config: Config): unknown {
  return config.host;
}
function readFromProxy(config: Config): unknown {
  return config.port;
}
function readFromGetter(config: Config): unknown {
  return config.host;
}
function readFromEmpty(config: Config): unknown {
  return config.secure;
}
function storeToMirror(config: Config): unknown {
  config.port = 8080;
  return config;
}
function storeToParsed(config: Config): unknown {
  config.host = "stored";
  return config;
}
function storeToFrozen(config: Config): unknown {
  config.secure = true;
  return config;
}
function storeToEmpty(config: Config): unknown {
  config.port = 1;
  config.host = "h";
  return config;
}
function storeToSetter(config: Config): unknown {
  config.port = 2;
  return config;
}
function storeToUndefined(config: Config): unknown {
  config.port = 3;
  return config;
}
function callOnMirror(config: Config): unknown {
  return config.address();
}
function callOnLiteral(config: Config): unknown {
  return config.address();
}
function callOnParsed(config: Config): unknown {
  return config.address();
}
function callOnText(config: Config): unknown {
  return config.address();
}
function callOnOwnMethod(config: Config): unknown {
  return config.address();
}
function callValue(callee: (port: number) => string): unknown {
  return callee(4);
}
function callNumber(callee: (port: number) => string): unknown {
  return callee(5);
}
function constructArrow(maker: new () => Config): unknown {
  return new maker();
}
function constructFunction(maker: new () => Config): unknown {
  return new maker();
}
function spreadMirror(config: Config): unknown {
  return { ...config, port: 6 };
}
function spreadNull(config: Config): unknown {
  // @ts-expect-error the spread writes over the field in front of it
  return { port: 7, ...config };
}
function patternOnParsed({ host, port = -1, secure }: Config): unknown {
  return [host, port, secure];
}
function updateOnMirror(config: Config): unknown {
  return (config.port += 1);
}
function deleteOnFrozen(config: Config): unknown {
  return delete (config as Partial<Config>).port;
}
function literalOfWrongValues(host: string, port: number, secure: boolean): unknown {
  return { host, port, secure };
}

const withOwnMethod = new Config();
withOwnMethod.address = () => "own method";

console.log("read, mirror:", attempt(() => readFromMirror(wrong(new Mirror()))));
console.log("read, parsed:", attempt(() => readFromParsed(JSON.parse('{"x":0,"port":"parsed"}'))));
console.log("read, null:", attempt(() => readFromNull(wrong(null))));
console.log("read, number:", attempt(() => readFromNumber(wrong(5))));
console.log("read, proxy:", attempt(() => readFromProxy(new Proxy(new Config(), { get: (_target, key) => "trapped " + String(key) }))));
console.log("read, getter:", attempt(() => readFromGetter(Object.defineProperty(new Config(), "host", { get: () => "from a getter" }))));
console.log("read, empty:", attempt(() => readFromEmpty(wrong({}))));
console.log("store, mirror:", attempt(() => storeToMirror(wrong(new Mirror()))));
console.log("store, parsed:", attempt(() => storeToParsed(JSON.parse('{"a":1,"host":"parsed","b":2}'))));
console.log("store, frozen:", attempt(() => storeToFrozen(Object.freeze(new Config()))));
console.log("store, empty:", attempt(() => storeToEmpty(wrong({}))));
console.log("store, setter:", attempt(() => storeToSetter(wrong({ set port(value: number) {}, host: "beside a setter" }))));
console.log("store, undefined:", attempt(() => storeToUndefined(wrong(undefined))));
console.log("call, mirror:", attempt(() => callOnMirror(wrong(new Mirror()))));
console.log("call, literal:", attempt(() => callOnLiteral(wrong({ address: () => "an arrow" }))));
console.log("call, parsed:", attempt(() => callOnParsed(JSON.parse('{"address":"a text"}'))));
console.log("call, text:", attempt(() => callOnText(wrong("text"))));
console.log("call, own method:", attempt(() => callOnOwnMethod(withOwnMethod)));
console.log("call by value:", attempt(() => callValue(wrong(function (this: unknown) { return String(this) + arguments.length; }))));
console.log("call of a number:", attempt(() => callNumber(wrong(5))));
console.log("construct, arrow:", attempt(() => constructArrow(wrong(() => new Config()))));
console.log("construct, function:", attempt(() => constructFunction(wrong(function (this: any) { this.made = true; }))));
console.log("spread, mirror:", attempt(() => spreadMirror(wrong(new Mirror()))));
console.log("spread, null:", attempt(() => spreadNull(wrong(null))));
console.log("pattern, parsed:", attempt(() => patternOnParsed(JSON.parse('{"secure":null,"host":[1]}'))));
console.log("update, mirror:", attempt(() => updateOnMirror(wrong(new Mirror()))));
console.log("delete, frozen:", attempt(() => deleteOnFrozen(Object.freeze(new Config()))));
console.log("literal:", attempt(() => literalOfWrongValues(wrong(1), wrong("two"), wrong(null))));

export {};
