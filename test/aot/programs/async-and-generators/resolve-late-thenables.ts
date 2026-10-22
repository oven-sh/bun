// An async function's result and an awaited value are adopted through `then` once the object or its prototype chain has one, and pass through unchanged otherwise.
const log: string[] = [];

type Resolve = (value: unknown) => void;
type Then = (resolve: Resolve) => void;

class Account {
  constructor(public id: number) {}
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Shape {
  constructor(public sides: number) {}
}
interface Download {
  url: string;
  then?: Then;
}
interface Upload {
  path: string;
  then?: unknown;
}
interface Settings {
  depth: number;
  label: string;
}

const returnAccount = async (account: Account): Promise<unknown> => account;
const awaitAccount = async (account: Account): Promise<unknown> => await account;
const returnDownload = async (download: Download): Promise<unknown> => download as unknown;
const awaitDownload = async (download: Download): Promise<unknown> => await (download as unknown);
const returnUpload = async (upload: Upload): Promise<unknown> => upload;
const awaitUpload = async (upload: Upload): Promise<unknown> => await upload;
const returnPoint = async (point: Point): Promise<unknown> => point;
const awaitPoint = async (point: Point): Promise<unknown> => await point;
const returnShape = async (shape: Shape): Promise<unknown> => shape;
const awaitShape = async (shape: Shape): Promise<unknown> => await shape;
const returnSettings = async (settings: Settings): Promise<unknown> => settings;
const awaitSettings = async (settings: Settings): Promise<unknown> => await settings;
const returnList = async (list: number[]): Promise<unknown> => list;
const awaitList = async (list: number[]): Promise<unknown> => await list;
const returnTable = async (table: Map<string, number>): Promise<unknown> => table;
const awaitTable = async (table: Map<string, number>): Promise<unknown> => await table;

function describe(value: unknown): string {
  if (value instanceof Map) return `Map(${value.size})`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function adopt(label: string): Then {
  return resolve => {
    log.push(`then of ${label}`);
    resolve(`adopted from ${label}`);
  };
}

async function observe(label: string, returned: Promise<unknown>, awaited: Promise<unknown>): Promise<void> {
  returned.then(value => log.push(`${label}: returned ${describe(value)}`));
  awaited.then(value => log.push(`${label}: awaited ${describe(value)}`));
  for (let turn = 1; turn <= 4; turn++) {
    await undefined;
    log.push(`${label}: turn ${turn}`);
  }
}

async function classInstances(): Promise<void> {
  const first = new Account(1);
  await observe("instance", returnAccount(first), awaitAccount(first));
  (Account.prototype as any).then = function (this: Account, resolve: Resolve): void {
    log.push(`then of account ${this.id}`);
    resolve(`adopted from account ${this.id}`);
  };
  const second = new Account(2);
  await observe("instance created after the class gained then", returnAccount(second), awaitAccount(second));
  await observe("instance created before the class gained then", returnAccount(first), awaitAccount(first));
  delete (Account.prototype as any).then;
  await observe("instance after the class lost then", returnAccount(second), awaitAccount(second));
}

async function optionalFields(): Promise<void> {
  const plainDownload: Download = { url: "a" };
  const thenableDownload: Download = { url: "b", then: adopt("download b") };
  await observe("absent field, first of its type", returnDownload(plainDownload), awaitDownload(plainDownload));
  await observe("present field, second of its type", returnDownload(thenableDownload), awaitDownload(thenableDownload));
  plainDownload.then = adopt("download a");
  await observe("field assigned later", returnDownload(plainDownload), awaitDownload(plainDownload));

  const thenableUpload: Upload = { path: "c", then: adopt("upload c") };
  const plainUpload: Upload = { path: "d" };
  await observe("present field, first of its type", returnUpload(thenableUpload), awaitUpload(thenableUpload));
  await observe("absent field, second of its type", returnUpload(plainUpload), awaitUpload(plainUpload));
}

async function extraProperties(): Promise<void> {
  const point = new Point(1, 2);
  await observe("instance without extra properties", returnPoint(point), awaitPoint(point));
  (point as any).then = adopt("point");
  await observe("instance with an extra then", returnPoint(point), awaitPoint(point));
  const sibling = new Point(3, 4);
  await observe("sibling without extra properties", returnPoint(sibling), awaitPoint(sibling));
  (sibling as any).label = "sibling";
  await observe("sibling with another extra property", returnPoint(sibling), awaitPoint(sibling));
  delete (point as any).then;
  await observe("instance after its extra then is deleted", returnPoint(point), awaitPoint(point));
}

async function createdPrototypes(): Promise<void> {
  const root = Object.create(Object.prototype);
  Object.setPrototypeOf(Shape.prototype, Object.create(root));
  const shape = new Shape(3);
  await observe("created objects on the chain", returnShape(shape), awaitShape(shape));
  root.then = adopt("created prototype");
  await observe("created prototype with then", returnShape(shape), awaitShape(shape));
  delete root.then;
  await observe("created prototype after then is deleted", returnShape(shape), awaitShape(shape));

  const derived: Shape = Object.create(shape);
  await observe("object created from an instance", returnShape(derived), awaitShape(derived));
  (shape as any).then = adopt("instance used as a prototype");
  await observe("object created from a thenable instance", returnShape(derived), awaitShape(derived));
}

async function plainData(): Promise<void> {
  const settings: Settings = { depth: 2, label: "plain" };
  await observe("data object", returnSettings(settings), awaitSettings(settings));
  const list = [1, 2, 3];
  await observe("array", returnList(list), awaitList(list));
  const table = new Map([["one", 1]]);
  await observe("map", returnTable(table), awaitTable(table));
}

async function main(): Promise<void> {
  await classInstances();
  await optionalFields();
  await extraProperties();
  await createdPrototypes();
  await plainData();
  console.log(log.join("\n"));
}

main();

export {};
