// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Containers in exported variables are reached from other modules in every way and altered there; the functions of their own module that call built-in methods on them see it.
import * as store from "./store";
import * as star from "./star";
import * as middle from "./middle";
import held from "./store";
import { reach } from "./untyped.js";
import { arrayNamedOwn, arrayNamedPrototype, mapNamedOwn, mapNamedPrototype, setNamedOwn, setNamedPrototype } from "./store";
const lines: string[] = [];
const show = (v: unknown): string => JSON.stringify(v, (k, x) => x === undefined ? "undefined" : x);
const notes: string[] = [];
function wrapper(said: string, m: string, home: any): any { return function (this: unknown, ...all: unknown[]) { notes.push(said + " " + m); return home[m].apply(this, all); }; }
function alterOwn(x: any, methods: string[]): void { const home = Object.getPrototypeOf(x); for (const m of methods) x[m] = wrapper("its own", m, home); }
function alterPrototype(x: any, methods: string[]): void { const home = Object.getPrototypeOf(x); const p = Object.create(home); for (const m of methods) p[m] = wrapper("inherited", m, home); Object.setPrototypeOf(x, p); }
function told(): string { const all = notes.join(", "); notes.length = 0; return all; }
const late = await import("./store");
const copy: Record<string, unknown> = { ...store };
const all = Object.values(store);
const order = Object.keys(store);
lines.push("arrayNamedOwn before " + show(store.use_arrayNamedOwn()) + " | " + told());
alterOwn(arrayNamedOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayNamedOwn after " + show(store.use_arrayNamedOwn()) + " | " + told());
lines.push("arrayNamedPrototype before " + show(store.use_arrayNamedPrototype()) + " | " + told());
alterPrototype(arrayNamedPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayNamedPrototype after " + show(store.use_arrayNamedPrototype()) + " | " + told());
lines.push("arrayMemberOwn before " + show(store.use_arrayMemberOwn()) + " | " + told());
alterOwn(store.arrayMemberOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayMemberOwn after " + show(store.use_arrayMemberOwn()) + " | " + told());
lines.push("arrayMemberPrototype before " + show(store.use_arrayMemberPrototype()) + " | " + told());
alterPrototype(store.arrayMemberPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayMemberPrototype after " + show(store.use_arrayMemberPrototype()) + " | " + told());
lines.push("arrayComputedOwn before " + show(store.use_arrayComputedOwn()) + " | " + told());
alterOwn((store as any)["arr" + "ayComputedOwn"], ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayComputedOwn after " + show(store.use_arrayComputedOwn()) + " | " + told());
lines.push("arrayComputedPrototype before " + show(store.use_arrayComputedPrototype()) + " | " + told());
alterPrototype((store as any)["arr" + "ayComputedPrototype"], ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayComputedPrototype after " + show(store.use_arrayComputedPrototype()) + " | " + told());
lines.push("arraySpreadOwn before " + show(store.use_arraySpreadOwn()) + " | " + told());
alterOwn(copy.arraySpreadOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arraySpreadOwn after " + show(store.use_arraySpreadOwn()) + " | " + told());
lines.push("arraySpreadPrototype before " + show(store.use_arraySpreadPrototype()) + " | " + told());
alterPrototype(copy.arraySpreadPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arraySpreadPrototype after " + show(store.use_arraySpreadPrototype()) + " | " + told());
lines.push("arrayValuesOwn before " + show(store.use_arrayValuesOwn()) + " | " + told());
alterOwn(all[order.indexOf("arrayValuesOwn")], ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayValuesOwn after " + show(store.use_arrayValuesOwn()) + " | " + told());
lines.push("arrayValuesPrototype before " + show(store.use_arrayValuesPrototype()) + " | " + told());
alterPrototype(all[order.indexOf("arrayValuesPrototype")], ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayValuesPrototype after " + show(store.use_arrayValuesPrototype()) + " | " + told());
lines.push("arrayReflectOwn before " + show(store.use_arrayReflectOwn()) + " | " + told());
alterOwn(Reflect.get(store, "arrayReflectOwn"), ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayReflectOwn after " + show(store.use_arrayReflectOwn()) + " | " + told());
lines.push("arrayReflectPrototype before " + show(store.use_arrayReflectPrototype()) + " | " + told());
alterPrototype(Reflect.get(store, "arrayReflectPrototype"), ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayReflectPrototype after " + show(store.use_arrayReflectPrototype()) + " | " + told());
lines.push("arrayDescriptorOwn before " + show(store.use_arrayDescriptorOwn()) + " | " + told());
alterOwn(Object.getOwnPropertyDescriptor(store, "arrayDescriptorOwn")!.value, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayDescriptorOwn after " + show(store.use_arrayDescriptorOwn()) + " | " + told());
lines.push("arrayDescriptorPrototype before " + show(store.use_arrayDescriptorPrototype()) + " | " + told());
alterPrototype(Object.getOwnPropertyDescriptor(store, "arrayDescriptorPrototype")!.value, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayDescriptorPrototype after " + show(store.use_arrayDescriptorPrototype()) + " | " + told());
lines.push("arrayDynamicOwn before " + show(store.use_arrayDynamicOwn()) + " | " + told());
alterOwn(late.arrayDynamicOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayDynamicOwn after " + show(store.use_arrayDynamicOwn()) + " | " + told());
lines.push("arrayDynamicPrototype before " + show(store.use_arrayDynamicPrototype()) + " | " + told());
alterPrototype(late.arrayDynamicPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayDynamicPrototype after " + show(store.use_arrayDynamicPrototype()) + " | " + told());
lines.push("arrayReexportedOwn before " + show(store.use_arrayReexportedOwn()) + " | " + told());
alterOwn(middle.again_arrayReexportedOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayReexportedOwn after " + show(store.use_arrayReexportedOwn()) + " | " + told());
lines.push("arrayReexportedPrototype before " + show(store.use_arrayReexportedPrototype()) + " | " + told());
alterPrototype(middle.again_arrayReexportedPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayReexportedPrototype after " + show(store.use_arrayReexportedPrototype()) + " | " + told());
lines.push("arrayStarredOwn before " + show(store.use_arrayStarredOwn()) + " | " + told());
alterOwn(star.arrayStarredOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayStarredOwn after " + show(store.use_arrayStarredOwn()) + " | " + told());
lines.push("arrayStarredPrototype before " + show(store.use_arrayStarredPrototype()) + " | " + told());
alterPrototype(star.arrayStarredPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayStarredPrototype after " + show(store.use_arrayStarredPrototype()) + " | " + told());
lines.push("arrayUntypedOwn before " + show(store.use_arrayUntypedOwn()) + " | " + told());
alterOwn(reach("arrayUntypedOwn"), ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayUntypedOwn after " + show(store.use_arrayUntypedOwn()) + " | " + told());
lines.push("arrayUntypedPrototype before " + show(store.use_arrayUntypedPrototype()) + " | " + told());
alterPrototype(reach("arrayUntypedPrototype"), ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayUntypedPrototype after " + show(store.use_arrayUntypedPrototype()) + " | " + told());
lines.push("arrayReturnedOwn before " + show(store.use_arrayReturnedOwn()) + " | " + told());
alterOwn(store.get_arrayReturnedOwn(), ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayReturnedOwn after " + show(store.use_arrayReturnedOwn()) + " | " + told());
lines.push("arrayReturnedPrototype before " + show(store.use_arrayReturnedPrototype()) + " | " + told());
alterPrototype(store.get_arrayReturnedPrototype(), ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayReturnedPrototype after " + show(store.use_arrayReturnedPrototype()) + " | " + told());
lines.push("arrayHandedOwn before " + show(store.use_arrayHandedOwn()) + " | " + told());
store.hand_arrayHandedOwn(v => alterOwn(v, ["includes", "map", "indexOf", "join", "filter", "some"]));
lines.push("arrayHandedOwn after " + show(store.use_arrayHandedOwn()) + " | " + told());
lines.push("arrayHandedPrototype before " + show(store.use_arrayHandedPrototype()) + " | " + told());
store.hand_arrayHandedPrototype(v => alterPrototype(v, ["includes", "map", "indexOf", "join", "filter", "some"]));
lines.push("arrayHandedPrototype after " + show(store.use_arrayHandedPrototype()) + " | " + told());
lines.push("arrayDefaultedOwn before " + show(store.use_arrayDefaultedOwn()) + " | " + told());
alterOwn(held.arrayDefaultedOwn, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayDefaultedOwn after " + show(store.use_arrayDefaultedOwn()) + " | " + told());
lines.push("arrayDefaultedPrototype before " + show(store.use_arrayDefaultedPrototype()) + " | " + told());
alterPrototype(held.arrayDefaultedPrototype, ["includes", "map", "indexOf", "join", "filter", "some"]);
lines.push("arrayDefaultedPrototype after " + show(store.use_arrayDefaultedPrototype()) + " | " + told());
lines.push("arrayUntouchedOwn before " + show(store.use_arrayUntouchedOwn()) + " | " + told());
lines.push("arrayUntouchedOwn after " + show(store.use_arrayUntouchedOwn()) + " | " + told());
lines.push("arrayUntouchedPrototype before " + show(store.use_arrayUntouchedPrototype()) + " | " + told());
lines.push("arrayUntouchedPrototype after " + show(store.use_arrayUntouchedPrototype()) + " | " + told());
lines.push("mapNamedOwn before " + show(store.use_mapNamedOwn()) + " | " + told());
alterOwn(mapNamedOwn, ["get", "has", "keys"]);
lines.push("mapNamedOwn after " + show(store.use_mapNamedOwn()) + " | " + told());
lines.push("mapNamedPrototype before " + show(store.use_mapNamedPrototype()) + " | " + told());
alterPrototype(mapNamedPrototype, ["get", "has", "keys"]);
lines.push("mapNamedPrototype after " + show(store.use_mapNamedPrototype()) + " | " + told());
lines.push("mapMemberOwn before " + show(store.use_mapMemberOwn()) + " | " + told());
alterOwn(store.mapMemberOwn, ["get", "has", "keys"]);
lines.push("mapMemberOwn after " + show(store.use_mapMemberOwn()) + " | " + told());
lines.push("mapMemberPrototype before " + show(store.use_mapMemberPrototype()) + " | " + told());
alterPrototype(store.mapMemberPrototype, ["get", "has", "keys"]);
lines.push("mapMemberPrototype after " + show(store.use_mapMemberPrototype()) + " | " + told());
lines.push("mapComputedOwn before " + show(store.use_mapComputedOwn()) + " | " + told());
alterOwn((store as any)["map" + "ComputedOwn"], ["get", "has", "keys"]);
lines.push("mapComputedOwn after " + show(store.use_mapComputedOwn()) + " | " + told());
lines.push("mapComputedPrototype before " + show(store.use_mapComputedPrototype()) + " | " + told());
alterPrototype((store as any)["map" + "ComputedPrototype"], ["get", "has", "keys"]);
lines.push("mapComputedPrototype after " + show(store.use_mapComputedPrototype()) + " | " + told());
lines.push("mapSpreadOwn before " + show(store.use_mapSpreadOwn()) + " | " + told());
alterOwn(copy.mapSpreadOwn, ["get", "has", "keys"]);
lines.push("mapSpreadOwn after " + show(store.use_mapSpreadOwn()) + " | " + told());
lines.push("mapSpreadPrototype before " + show(store.use_mapSpreadPrototype()) + " | " + told());
alterPrototype(copy.mapSpreadPrototype, ["get", "has", "keys"]);
lines.push("mapSpreadPrototype after " + show(store.use_mapSpreadPrototype()) + " | " + told());
lines.push("mapValuesOwn before " + show(store.use_mapValuesOwn()) + " | " + told());
alterOwn(all[order.indexOf("mapValuesOwn")], ["get", "has", "keys"]);
lines.push("mapValuesOwn after " + show(store.use_mapValuesOwn()) + " | " + told());
lines.push("mapValuesPrototype before " + show(store.use_mapValuesPrototype()) + " | " + told());
alterPrototype(all[order.indexOf("mapValuesPrototype")], ["get", "has", "keys"]);
lines.push("mapValuesPrototype after " + show(store.use_mapValuesPrototype()) + " | " + told());
lines.push("mapReflectOwn before " + show(store.use_mapReflectOwn()) + " | " + told());
alterOwn(Reflect.get(store, "mapReflectOwn"), ["get", "has", "keys"]);
lines.push("mapReflectOwn after " + show(store.use_mapReflectOwn()) + " | " + told());
lines.push("mapReflectPrototype before " + show(store.use_mapReflectPrototype()) + " | " + told());
alterPrototype(Reflect.get(store, "mapReflectPrototype"), ["get", "has", "keys"]);
lines.push("mapReflectPrototype after " + show(store.use_mapReflectPrototype()) + " | " + told());
lines.push("mapDescriptorOwn before " + show(store.use_mapDescriptorOwn()) + " | " + told());
alterOwn(Object.getOwnPropertyDescriptor(store, "mapDescriptorOwn")!.value, ["get", "has", "keys"]);
lines.push("mapDescriptorOwn after " + show(store.use_mapDescriptorOwn()) + " | " + told());
lines.push("mapDescriptorPrototype before " + show(store.use_mapDescriptorPrototype()) + " | " + told());
alterPrototype(Object.getOwnPropertyDescriptor(store, "mapDescriptorPrototype")!.value, ["get", "has", "keys"]);
lines.push("mapDescriptorPrototype after " + show(store.use_mapDescriptorPrototype()) + " | " + told());
lines.push("mapDynamicOwn before " + show(store.use_mapDynamicOwn()) + " | " + told());
alterOwn(late.mapDynamicOwn, ["get", "has", "keys"]);
lines.push("mapDynamicOwn after " + show(store.use_mapDynamicOwn()) + " | " + told());
lines.push("mapDynamicPrototype before " + show(store.use_mapDynamicPrototype()) + " | " + told());
alterPrototype(late.mapDynamicPrototype, ["get", "has", "keys"]);
lines.push("mapDynamicPrototype after " + show(store.use_mapDynamicPrototype()) + " | " + told());
lines.push("mapReexportedOwn before " + show(store.use_mapReexportedOwn()) + " | " + told());
alterOwn(middle.again_mapReexportedOwn, ["get", "has", "keys"]);
lines.push("mapReexportedOwn after " + show(store.use_mapReexportedOwn()) + " | " + told());
lines.push("mapReexportedPrototype before " + show(store.use_mapReexportedPrototype()) + " | " + told());
alterPrototype(middle.again_mapReexportedPrototype, ["get", "has", "keys"]);
lines.push("mapReexportedPrototype after " + show(store.use_mapReexportedPrototype()) + " | " + told());
lines.push("mapStarredOwn before " + show(store.use_mapStarredOwn()) + " | " + told());
alterOwn(star.mapStarredOwn, ["get", "has", "keys"]);
lines.push("mapStarredOwn after " + show(store.use_mapStarredOwn()) + " | " + told());
lines.push("mapStarredPrototype before " + show(store.use_mapStarredPrototype()) + " | " + told());
alterPrototype(star.mapStarredPrototype, ["get", "has", "keys"]);
lines.push("mapStarredPrototype after " + show(store.use_mapStarredPrototype()) + " | " + told());
lines.push("mapUntypedOwn before " + show(store.use_mapUntypedOwn()) + " | " + told());
alterOwn(reach("mapUntypedOwn"), ["get", "has", "keys"]);
lines.push("mapUntypedOwn after " + show(store.use_mapUntypedOwn()) + " | " + told());
lines.push("mapUntypedPrototype before " + show(store.use_mapUntypedPrototype()) + " | " + told());
alterPrototype(reach("mapUntypedPrototype"), ["get", "has", "keys"]);
lines.push("mapUntypedPrototype after " + show(store.use_mapUntypedPrototype()) + " | " + told());
lines.push("mapReturnedOwn before " + show(store.use_mapReturnedOwn()) + " | " + told());
alterOwn(store.get_mapReturnedOwn(), ["get", "has", "keys"]);
lines.push("mapReturnedOwn after " + show(store.use_mapReturnedOwn()) + " | " + told());
lines.push("mapReturnedPrototype before " + show(store.use_mapReturnedPrototype()) + " | " + told());
alterPrototype(store.get_mapReturnedPrototype(), ["get", "has", "keys"]);
lines.push("mapReturnedPrototype after " + show(store.use_mapReturnedPrototype()) + " | " + told());
lines.push("mapHandedOwn before " + show(store.use_mapHandedOwn()) + " | " + told());
store.hand_mapHandedOwn(v => alterOwn(v, ["get", "has", "keys"]));
lines.push("mapHandedOwn after " + show(store.use_mapHandedOwn()) + " | " + told());
lines.push("mapHandedPrototype before " + show(store.use_mapHandedPrototype()) + " | " + told());
store.hand_mapHandedPrototype(v => alterPrototype(v, ["get", "has", "keys"]));
lines.push("mapHandedPrototype after " + show(store.use_mapHandedPrototype()) + " | " + told());
lines.push("mapDefaultedOwn before " + show(store.use_mapDefaultedOwn()) + " | " + told());
alterOwn(held.mapDefaultedOwn, ["get", "has", "keys"]);
lines.push("mapDefaultedOwn after " + show(store.use_mapDefaultedOwn()) + " | " + told());
lines.push("mapDefaultedPrototype before " + show(store.use_mapDefaultedPrototype()) + " | " + told());
alterPrototype(held.mapDefaultedPrototype, ["get", "has", "keys"]);
lines.push("mapDefaultedPrototype after " + show(store.use_mapDefaultedPrototype()) + " | " + told());
lines.push("mapUntouchedOwn before " + show(store.use_mapUntouchedOwn()) + " | " + told());
lines.push("mapUntouchedOwn after " + show(store.use_mapUntouchedOwn()) + " | " + told());
lines.push("mapUntouchedPrototype before " + show(store.use_mapUntouchedPrototype()) + " | " + told());
lines.push("mapUntouchedPrototype after " + show(store.use_mapUntouchedPrototype()) + " | " + told());
lines.push("setNamedOwn before " + show(store.use_setNamedOwn()) + " | " + told());
alterOwn(setNamedOwn, ["has", "values"]);
lines.push("setNamedOwn after " + show(store.use_setNamedOwn()) + " | " + told());
lines.push("setNamedPrototype before " + show(store.use_setNamedPrototype()) + " | " + told());
alterPrototype(setNamedPrototype, ["has", "values"]);
lines.push("setNamedPrototype after " + show(store.use_setNamedPrototype()) + " | " + told());
lines.push("setMemberOwn before " + show(store.use_setMemberOwn()) + " | " + told());
alterOwn(store.setMemberOwn, ["has", "values"]);
lines.push("setMemberOwn after " + show(store.use_setMemberOwn()) + " | " + told());
lines.push("setMemberPrototype before " + show(store.use_setMemberPrototype()) + " | " + told());
alterPrototype(store.setMemberPrototype, ["has", "values"]);
lines.push("setMemberPrototype after " + show(store.use_setMemberPrototype()) + " | " + told());
lines.push("setComputedOwn before " + show(store.use_setComputedOwn()) + " | " + told());
alterOwn((store as any)["set" + "ComputedOwn"], ["has", "values"]);
lines.push("setComputedOwn after " + show(store.use_setComputedOwn()) + " | " + told());
lines.push("setComputedPrototype before " + show(store.use_setComputedPrototype()) + " | " + told());
alterPrototype((store as any)["set" + "ComputedPrototype"], ["has", "values"]);
lines.push("setComputedPrototype after " + show(store.use_setComputedPrototype()) + " | " + told());
lines.push("setSpreadOwn before " + show(store.use_setSpreadOwn()) + " | " + told());
alterOwn(copy.setSpreadOwn, ["has", "values"]);
lines.push("setSpreadOwn after " + show(store.use_setSpreadOwn()) + " | " + told());
lines.push("setSpreadPrototype before " + show(store.use_setSpreadPrototype()) + " | " + told());
alterPrototype(copy.setSpreadPrototype, ["has", "values"]);
lines.push("setSpreadPrototype after " + show(store.use_setSpreadPrototype()) + " | " + told());
lines.push("setValuesOwn before " + show(store.use_setValuesOwn()) + " | " + told());
alterOwn(all[order.indexOf("setValuesOwn")], ["has", "values"]);
lines.push("setValuesOwn after " + show(store.use_setValuesOwn()) + " | " + told());
lines.push("setValuesPrototype before " + show(store.use_setValuesPrototype()) + " | " + told());
alterPrototype(all[order.indexOf("setValuesPrototype")], ["has", "values"]);
lines.push("setValuesPrototype after " + show(store.use_setValuesPrototype()) + " | " + told());
lines.push("setReflectOwn before " + show(store.use_setReflectOwn()) + " | " + told());
alterOwn(Reflect.get(store, "setReflectOwn"), ["has", "values"]);
lines.push("setReflectOwn after " + show(store.use_setReflectOwn()) + " | " + told());
lines.push("setReflectPrototype before " + show(store.use_setReflectPrototype()) + " | " + told());
alterPrototype(Reflect.get(store, "setReflectPrototype"), ["has", "values"]);
lines.push("setReflectPrototype after " + show(store.use_setReflectPrototype()) + " | " + told());
lines.push("setDescriptorOwn before " + show(store.use_setDescriptorOwn()) + " | " + told());
alterOwn(Object.getOwnPropertyDescriptor(store, "setDescriptorOwn")!.value, ["has", "values"]);
lines.push("setDescriptorOwn after " + show(store.use_setDescriptorOwn()) + " | " + told());
lines.push("setDescriptorPrototype before " + show(store.use_setDescriptorPrototype()) + " | " + told());
alterPrototype(Object.getOwnPropertyDescriptor(store, "setDescriptorPrototype")!.value, ["has", "values"]);
lines.push("setDescriptorPrototype after " + show(store.use_setDescriptorPrototype()) + " | " + told());
lines.push("setDynamicOwn before " + show(store.use_setDynamicOwn()) + " | " + told());
alterOwn(late.setDynamicOwn, ["has", "values"]);
lines.push("setDynamicOwn after " + show(store.use_setDynamicOwn()) + " | " + told());
lines.push("setDynamicPrototype before " + show(store.use_setDynamicPrototype()) + " | " + told());
alterPrototype(late.setDynamicPrototype, ["has", "values"]);
lines.push("setDynamicPrototype after " + show(store.use_setDynamicPrototype()) + " | " + told());
lines.push("setReexportedOwn before " + show(store.use_setReexportedOwn()) + " | " + told());
alterOwn(middle.again_setReexportedOwn, ["has", "values"]);
lines.push("setReexportedOwn after " + show(store.use_setReexportedOwn()) + " | " + told());
lines.push("setReexportedPrototype before " + show(store.use_setReexportedPrototype()) + " | " + told());
alterPrototype(middle.again_setReexportedPrototype, ["has", "values"]);
lines.push("setReexportedPrototype after " + show(store.use_setReexportedPrototype()) + " | " + told());
lines.push("setStarredOwn before " + show(store.use_setStarredOwn()) + " | " + told());
alterOwn(star.setStarredOwn, ["has", "values"]);
lines.push("setStarredOwn after " + show(store.use_setStarredOwn()) + " | " + told());
lines.push("setStarredPrototype before " + show(store.use_setStarredPrototype()) + " | " + told());
alterPrototype(star.setStarredPrototype, ["has", "values"]);
lines.push("setStarredPrototype after " + show(store.use_setStarredPrototype()) + " | " + told());
lines.push("setUntypedOwn before " + show(store.use_setUntypedOwn()) + " | " + told());
alterOwn(reach("setUntypedOwn"), ["has", "values"]);
lines.push("setUntypedOwn after " + show(store.use_setUntypedOwn()) + " | " + told());
lines.push("setUntypedPrototype before " + show(store.use_setUntypedPrototype()) + " | " + told());
alterPrototype(reach("setUntypedPrototype"), ["has", "values"]);
lines.push("setUntypedPrototype after " + show(store.use_setUntypedPrototype()) + " | " + told());
lines.push("setReturnedOwn before " + show(store.use_setReturnedOwn()) + " | " + told());
alterOwn(store.get_setReturnedOwn(), ["has", "values"]);
lines.push("setReturnedOwn after " + show(store.use_setReturnedOwn()) + " | " + told());
lines.push("setReturnedPrototype before " + show(store.use_setReturnedPrototype()) + " | " + told());
alterPrototype(store.get_setReturnedPrototype(), ["has", "values"]);
lines.push("setReturnedPrototype after " + show(store.use_setReturnedPrototype()) + " | " + told());
lines.push("setHandedOwn before " + show(store.use_setHandedOwn()) + " | " + told());
store.hand_setHandedOwn(v => alterOwn(v, ["has", "values"]));
lines.push("setHandedOwn after " + show(store.use_setHandedOwn()) + " | " + told());
lines.push("setHandedPrototype before " + show(store.use_setHandedPrototype()) + " | " + told());
store.hand_setHandedPrototype(v => alterPrototype(v, ["has", "values"]));
lines.push("setHandedPrototype after " + show(store.use_setHandedPrototype()) + " | " + told());
lines.push("setDefaultedOwn before " + show(store.use_setDefaultedOwn()) + " | " + told());
alterOwn(held.setDefaultedOwn, ["has", "values"]);
lines.push("setDefaultedOwn after " + show(store.use_setDefaultedOwn()) + " | " + told());
lines.push("setDefaultedPrototype before " + show(store.use_setDefaultedPrototype()) + " | " + told());
alterPrototype(held.setDefaultedPrototype, ["has", "values"]);
lines.push("setDefaultedPrototype after " + show(store.use_setDefaultedPrototype()) + " | " + told());
lines.push("setUntouchedOwn before " + show(store.use_setUntouchedOwn()) + " | " + told());
lines.push("setUntouchedOwn after " + show(store.use_setUntouchedOwn()) + " | " + told());
lines.push("setUntouchedPrototype before " + show(store.use_setUntouchedPrototype()) + " | " + told());
lines.push("setUntouchedPrototype after " + show(store.use_setUntouchedPrototype()) + " | " + told());
lines.push("hiddenArray " + show(store.use_hiddenArray()) + " | " + told());
lines.push("hiddenMap " + show(store.use_hiddenMap()) + " | " + told());
lines.push("hiddenSet " + show(store.use_hiddenSet()) + " | " + told());
console.log(lines.join("\n"));

// FILE: middle.ts
// Re-exports under other names.
export { arrayReexportedOwn as again_arrayReexportedOwn } from "./store";
export { arrayReexportedPrototype as again_arrayReexportedPrototype } from "./store";
export { mapReexportedOwn as again_mapReexportedOwn } from "./store";
export { mapReexportedPrototype as again_mapReexportedPrototype } from "./store";
export { setReexportedOwn as again_setReexportedOwn } from "./store";
export { setReexportedPrototype as again_setReexportedPrototype } from "./store";

// FILE: star.ts
// Re-exports everything.
export * from "./store";

// FILE: store.ts
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

// FILE: untyped.js
// Untyped code that imports the store by itself.
import * as store from "./store";
export function reach(name) { return store[name]; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: alterPrototype told show
// CHECK-LABEL: function {{*}}name="alterPrototype"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|Array<undefined|null|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=Object
// CHECK-NEXT: v7 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v8 = Call v7, v6, v5 calleeName="Object.create"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v10 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = IteratorResume v10
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Branch v13 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Builtin builtin=Object
// CHECK-NEXT: v16 = Builtin builtin=ObjectSetPrototypeOf
// CHECK-NEXT: v17 = Call v16, v15, v0, v9 calleeName="Object.setPrototypeOf"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v19 = Convert v14 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v21 = String string="inherited"
// CHECK-NEXT: v22 = Call v20, -, v21, v19, v5 calleeName="wrapper"
// CHECK-NEXT: ElemSet v9, v19, v22
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v10:
// CHECK-NEXT: v24 = CatchException
// CHECK-NEXT: IteratorClose v10 completion=Throw
// CHECK-NEXT: Rethrow v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="told"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="notes"
// CHECK-NEXT: v2 = PropGet v1 key="join"
// CHECK-NEXT: v3 = String string=", "
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="join" calleeName="notes.join"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="notes"
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_7]]}
// CHECK-NEXT: PropSet v7, v9 key="length"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=JSON
// CHECK-NEXT: v2 = PropGet v1 key="stringify"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v4 = NewClosure function=[[f_10]]
// CHECK-NEXT: v5 = Call v3, v1, v0, v4 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
