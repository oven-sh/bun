// An instance of a class below Map is a Map cell. Between two calls of an inherited built-in method something changes what the name finds.
class Other {
  get(_key: string): number { return -5; }
  set(_key: string, _value: number): this { return this; }
  has(_key: string): boolean { return true; }
}
const name = ["g", "et"].join("");
function nothing(_map: unknown): void {}


class MProtoOfInstance extends Map<string, number> {}
function useProtoOfInstance(map: MProtoOfInstance, change: (map: MProtoOfInstance) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeProtoOfInstance(map: MProtoOfInstance): void {
  Object.setPrototypeOf(map, Other.prototype);
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useProtoOfInstance(new MProtoOfInstance(), nothing);
  console.log("ProtoOfInstance", sum, useProtoOfInstance(new MProtoOfInstance(), changeProtoOfInstance), useProtoOfInstance(new MProtoOfInstance(), nothing));
}

class MDunderProto extends Map<string, number> {}
function useDunderProto(map: MDunderProto, change: (map: MDunderProto) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeDunderProto(map: MDunderProto): void {
  (map as any).__proto__ = Other.prototype;
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useDunderProto(new MDunderProto(), nothing);
  console.log("DunderProto", sum, useDunderProto(new MDunderProto(), changeDunderProto), useDunderProto(new MDunderProto(), nothing));
}

class MOwnByName extends Map<string, number> {}
function useOwnByName(map: MOwnByName, change: (map: MOwnByName) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeOwnByName(map: MOwnByName): void {
  (map as any).get = function () { return -7; };
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useOwnByName(new MOwnByName(), nothing);
  console.log("OwnByName", sum, useOwnByName(new MOwnByName(), changeOwnByName), useOwnByName(new MOwnByName(), nothing));
}

class MOwnByKey extends Map<string, number> {}
function useOwnByKey(map: MOwnByKey, change: (map: MOwnByKey) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeOwnByKey(map: MOwnByKey): void {
  (map as any)[name] = function () { return -7; };
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useOwnByKey(new MOwnByKey(), nothing);
  console.log("OwnByKey", sum, useOwnByKey(new MOwnByKey(), changeOwnByKey), useOwnByKey(new MOwnByKey(), nothing));
}

class MOwnDefined extends Map<string, number> {}
function useOwnDefined(map: MOwnDefined, change: (map: MOwnDefined) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeOwnDefined(map: MOwnDefined): void {
  Object.defineProperty(map, "get", { value: function () { return -7; }, configurable: true });
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useOwnDefined(new MOwnDefined(), nothing);
  console.log("OwnDefined", sum, useOwnDefined(new MOwnDefined(), changeOwnDefined), useOwnDefined(new MOwnDefined(), nothing));
}

class MOnPrototypeByName extends Map<string, number> {}
function useOnPrototypeByName(map: MOnPrototypeByName, change: (map: MOnPrototypeByName) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeOnPrototypeByName(map: MOnPrototypeByName): void {
  (MOnPrototypeByName.prototype as any).get = function () { return -9; };
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useOnPrototypeByName(new MOnPrototypeByName(), nothing);
  console.log("OnPrototypeByName", sum, useOnPrototypeByName(new MOnPrototypeByName(), changeOnPrototypeByName), useOnPrototypeByName(new MOnPrototypeByName(), nothing));
}

class MOnPrototypeByKey extends Map<string, number> {}
function useOnPrototypeByKey(map: MOnPrototypeByKey, change: (map: MOnPrototypeByKey) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeOnPrototypeByKey(map: MOnPrototypeByKey): void {
  (MOnPrototypeByKey.prototype as any)[name] = function () { return -9; };
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useOnPrototypeByKey(new MOnPrototypeByKey(), nothing);
  console.log("OnPrototypeByKey", sum, useOnPrototypeByKey(new MOnPrototypeByKey(), changeOnPrototypeByKey), useOnPrototypeByKey(new MOnPrototypeByKey(), nothing));
}

class MOnPrototypeDefined extends Map<string, number> {}
function useOnPrototypeDefined(map: MOnPrototypeDefined, change: (map: MOnPrototypeDefined) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeOnPrototypeDefined(map: MOnPrototypeDefined): void {
  Object.defineProperty(MOnPrototypeDefined.prototype, name, { value: function () { return -9; }, configurable: true });
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useOnPrototypeDefined(new MOnPrototypeDefined(), nothing);
  console.log("OnPrototypeDefined", sum, useOnPrototypeDefined(new MOnPrototypeDefined(), changeOnPrototypeDefined), useOnPrototypeDefined(new MOnPrototypeDefined(), nothing));
}

class MLinkOfPrototype extends Map<string, number> {}
function useLinkOfPrototype(map: MLinkOfPrototype, change: (map: MLinkOfPrototype) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeLinkOfPrototype(map: MLinkOfPrototype): void {
  Object.setPrototypeOf(MLinkOfPrototype.prototype, Other.prototype);
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useLinkOfPrototype(new MLinkOfPrototype(), nothing);
  console.log("LinkOfPrototype", sum, useLinkOfPrototype(new MLinkOfPrototype(), changeLinkOfPrototype), useLinkOfPrototype(new MLinkOfPrototype(), nothing));
}

class MReflectLink extends Map<string, number> {}
function useReflectLink(map: MReflectLink, change: (map: MReflectLink) => void): number {
  map.set("k", 1);
  let sum = map.get("k")!;
  change(map);
  sum += map.get("k")! * 10;
  if (map.has("zz")) sum += 1000;
  return sum;
}
function changeReflectLink(map: MReflectLink): void {
  Reflect.setPrototypeOf(MReflectLink.prototype, Other.prototype);
}
{
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += useReflectLink(new MReflectLink(), nothing);
  console.log("ReflectLink", sum, useReflectLink(new MReflectLink(), changeReflectLink), useReflectLink(new MReflectLink(), nothing));
}
