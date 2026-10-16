// Containers in exported variables, and beside each a function that calls built-in methods on it.
export const arrayNamedOwn: number[] = [1, 2, 3];
export function use_arrayNamedOwn(): unknown[] { const v = arrayNamedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayNamedPrototype: number[] = [1, 2, 3];
export function use_arrayNamedPrototype(): unknown[] { const v = arrayNamedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayMemberOwn: number[] = [1, 2, 3];
export function use_arrayMemberOwn(): unknown[] { const v = arrayMemberOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayMemberPrototype: number[] = [1, 2, 3];
export function use_arrayMemberPrototype(): unknown[] { const v = arrayMemberPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayComputedOwn: number[] = [1, 2, 3];
export function use_arrayComputedOwn(): unknown[] { const v = arrayComputedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayComputedPrototype: number[] = [1, 2, 3];
export function use_arrayComputedPrototype(): unknown[] { const v = arrayComputedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arraySpreadOwn: number[] = [1, 2, 3];
export function use_arraySpreadOwn(): unknown[] { const v = arraySpreadOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arraySpreadPrototype: number[] = [1, 2, 3];
export function use_arraySpreadPrototype(): unknown[] { const v = arraySpreadPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayValuesOwn: number[] = [1, 2, 3];
export function use_arrayValuesOwn(): unknown[] { const v = arrayValuesOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayValuesPrototype: number[] = [1, 2, 3];
export function use_arrayValuesPrototype(): unknown[] { const v = arrayValuesPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayReflectOwn: number[] = [1, 2, 3];
export function use_arrayReflectOwn(): unknown[] { const v = arrayReflectOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayReflectPrototype: number[] = [1, 2, 3];
export function use_arrayReflectPrototype(): unknown[] { const v = arrayReflectPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayDescriptorOwn: number[] = [1, 2, 3];
export function use_arrayDescriptorOwn(): unknown[] { const v = arrayDescriptorOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayDescriptorPrototype: number[] = [1, 2, 3];
export function use_arrayDescriptorPrototype(): unknown[] { const v = arrayDescriptorPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayDynamicOwn: number[] = [1, 2, 3];
export function use_arrayDynamicOwn(): unknown[] { const v = arrayDynamicOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayDynamicPrototype: number[] = [1, 2, 3];
export function use_arrayDynamicPrototype(): unknown[] { const v = arrayDynamicPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayReexportedOwn: number[] = [1, 2, 3];
export function use_arrayReexportedOwn(): unknown[] { const v = arrayReexportedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayReexportedPrototype: number[] = [1, 2, 3];
export function use_arrayReexportedPrototype(): unknown[] { const v = arrayReexportedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayStarredOwn: number[] = [1, 2, 3];
export function use_arrayStarredOwn(): unknown[] { const v = arrayStarredOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayStarredPrototype: number[] = [1, 2, 3];
export function use_arrayStarredPrototype(): unknown[] { const v = arrayStarredPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayUntypedOwn: number[] = [1, 2, 3];
export function use_arrayUntypedOwn(): unknown[] { const v = arrayUntypedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayUntypedPrototype: number[] = [1, 2, 3];
export function use_arrayUntypedPrototype(): unknown[] { const v = arrayUntypedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayReturnedOwn: number[] = [1, 2, 3];
export function use_arrayReturnedOwn(): unknown[] { const v = arrayReturnedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export function get_arrayReturnedOwn(): number[] { return arrayReturnedOwn; }
export const arrayReturnedPrototype: number[] = [1, 2, 3];
export function use_arrayReturnedPrototype(): unknown[] { const v = arrayReturnedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export function get_arrayReturnedPrototype(): number[] { return arrayReturnedPrototype; }
export const arrayHandedOwn: number[] = [1, 2, 3];
export function use_arrayHandedOwn(): unknown[] { const v = arrayHandedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export function hand_arrayHandedOwn(f: (v: number[]) => void): void { f(arrayHandedOwn); }
export const arrayHandedPrototype: number[] = [1, 2, 3];
export function use_arrayHandedPrototype(): unknown[] { const v = arrayHandedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export function hand_arrayHandedPrototype(f: (v: number[]) => void): void { f(arrayHandedPrototype); }
export const arrayDefaultedOwn: number[] = [1, 2, 3];
export function use_arrayDefaultedOwn(): unknown[] { const v = arrayDefaultedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayDefaultedPrototype: number[] = [1, 2, 3];
export function use_arrayDefaultedPrototype(): unknown[] { const v = arrayDefaultedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayUntouchedOwn: number[] = [1, 2, 3];
export function use_arrayUntouchedOwn(): unknown[] { const v = arrayUntouchedOwn; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const arrayUntouchedPrototype: number[] = [1, 2, 3];
export function use_arrayUntouchedPrototype(): unknown[] { const v = arrayUntouchedPrototype; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
export const mapNamedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapNamedOwn(): unknown[] { const v = mapNamedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapNamedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapNamedPrototype(): unknown[] { const v = mapNamedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapMemberOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapMemberOwn(): unknown[] { const v = mapMemberOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapMemberPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapMemberPrototype(): unknown[] { const v = mapMemberPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapComputedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapComputedOwn(): unknown[] { const v = mapComputedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapComputedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapComputedPrototype(): unknown[] { const v = mapComputedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapSpreadOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapSpreadOwn(): unknown[] { const v = mapSpreadOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapSpreadPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapSpreadPrototype(): unknown[] { const v = mapSpreadPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapValuesOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapValuesOwn(): unknown[] { const v = mapValuesOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapValuesPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapValuesPrototype(): unknown[] { const v = mapValuesPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapReflectOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapReflectOwn(): unknown[] { const v = mapReflectOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapReflectPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapReflectPrototype(): unknown[] { const v = mapReflectPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapDescriptorOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapDescriptorOwn(): unknown[] { const v = mapDescriptorOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapDescriptorPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapDescriptorPrototype(): unknown[] { const v = mapDescriptorPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapDynamicOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapDynamicOwn(): unknown[] { const v = mapDynamicOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapDynamicPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapDynamicPrototype(): unknown[] { const v = mapDynamicPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapReexportedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapReexportedOwn(): unknown[] { const v = mapReexportedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapReexportedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapReexportedPrototype(): unknown[] { const v = mapReexportedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapStarredOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapStarredOwn(): unknown[] { const v = mapStarredOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapStarredPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapStarredPrototype(): unknown[] { const v = mapStarredPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapUntypedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapUntypedOwn(): unknown[] { const v = mapUntypedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapUntypedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapUntypedPrototype(): unknown[] { const v = mapUntypedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapReturnedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapReturnedOwn(): unknown[] { const v = mapReturnedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export function get_mapReturnedOwn(): Map<string, number> { return mapReturnedOwn; }
export const mapReturnedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapReturnedPrototype(): unknown[] { const v = mapReturnedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export function get_mapReturnedPrototype(): Map<string, number> { return mapReturnedPrototype; }
export const mapHandedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapHandedOwn(): unknown[] { const v = mapHandedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export function hand_mapHandedOwn(f: (v: Map<string, number>) => void): void { f(mapHandedOwn); }
export const mapHandedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapHandedPrototype(): unknown[] { const v = mapHandedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export function hand_mapHandedPrototype(f: (v: Map<string, number>) => void): void { f(mapHandedPrototype); }
export const mapDefaultedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapDefaultedOwn(): unknown[] { const v = mapDefaultedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapDefaultedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapDefaultedPrototype(): unknown[] { const v = mapDefaultedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapUntouchedOwn: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapUntouchedOwn(): unknown[] { const v = mapUntouchedOwn; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const mapUntouchedPrototype: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_mapUntouchedPrototype(): unknown[] { const v = mapUntouchedPrototype; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
export const setNamedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setNamedOwn(): unknown[] { const v = setNamedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setNamedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setNamedPrototype(): unknown[] { const v = setNamedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setMemberOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setMemberOwn(): unknown[] { const v = setMemberOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setMemberPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setMemberPrototype(): unknown[] { const v = setMemberPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setComputedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setComputedOwn(): unknown[] { const v = setComputedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setComputedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setComputedPrototype(): unknown[] { const v = setComputedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setSpreadOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setSpreadOwn(): unknown[] { const v = setSpreadOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setSpreadPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setSpreadPrototype(): unknown[] { const v = setSpreadPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setValuesOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setValuesOwn(): unknown[] { const v = setValuesOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setValuesPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setValuesPrototype(): unknown[] { const v = setValuesPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setReflectOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setReflectOwn(): unknown[] { const v = setReflectOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setReflectPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setReflectPrototype(): unknown[] { const v = setReflectPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setDescriptorOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setDescriptorOwn(): unknown[] { const v = setDescriptorOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setDescriptorPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setDescriptorPrototype(): unknown[] { const v = setDescriptorPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setDynamicOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setDynamicOwn(): unknown[] { const v = setDynamicOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setDynamicPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setDynamicPrototype(): unknown[] { const v = setDynamicPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setReexportedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setReexportedOwn(): unknown[] { const v = setReexportedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setReexportedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setReexportedPrototype(): unknown[] { const v = setReexportedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setStarredOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setStarredOwn(): unknown[] { const v = setStarredOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setStarredPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setStarredPrototype(): unknown[] { const v = setStarredPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setUntypedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setUntypedOwn(): unknown[] { const v = setUntypedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setUntypedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setUntypedPrototype(): unknown[] { const v = setUntypedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setReturnedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setReturnedOwn(): unknown[] { const v = setReturnedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export function get_setReturnedOwn(): Set<string> { return setReturnedOwn; }
export const setReturnedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setReturnedPrototype(): unknown[] { const v = setReturnedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export function get_setReturnedPrototype(): Set<string> { return setReturnedPrototype; }
export const setHandedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setHandedOwn(): unknown[] { const v = setHandedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export function hand_setHandedOwn(f: (v: Set<string>) => void): void { f(setHandedOwn); }
export const setHandedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setHandedPrototype(): unknown[] { const v = setHandedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export function hand_setHandedPrototype(f: (v: Set<string>) => void): void { f(setHandedPrototype); }
export const setDefaultedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setDefaultedOwn(): unknown[] { const v = setDefaultedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setDefaultedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setDefaultedPrototype(): unknown[] { const v = setDefaultedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setUntouchedOwn: Set<string> = new Set<string>(["a", "b"]);
export function use_setUntouchedOwn(): unknown[] { const v = setUntouchedOwn; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export const setUntouchedPrototype: Set<string> = new Set<string>(["a", "b"]);
export function use_setUntouchedPrototype(): unknown[] { const v = setUntouchedPrototype; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
const hiddenArray: number[] = [1, 2, 3];
export function use_hiddenArray(): unknown[] { const v = hiddenArray; return [v.includes(2), v.map(x => x * 2).join(), v.length, v.indexOf(3), v.join("-"), v.filter(x => x > 1).length, v.some(x => x === 3)]; }
const hiddenMap: Map<string, number> = new Map<string, number>([["a", 1], ["b", 2]]);
export function use_hiddenMap(): unknown[] { const v = hiddenMap; return [v.get("a"), v.has("b"), v.size, [...v.keys()].join()]; }
const hiddenSet: Set<string> = new Set<string>(["a", "b"]);
export function use_hiddenSet(): unknown[] { const v = hiddenSet; return [v.has("a"), v.has("z"), v.size, [...v.values()].join()]; }
export default { arrayDefaultedOwn, arrayDefaultedPrototype, mapDefaultedOwn, mapDefaultedPrototype, setDefaultedOwn, setDefaultedPrototype };
