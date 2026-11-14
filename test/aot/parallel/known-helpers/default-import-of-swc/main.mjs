// STATISTIC: KnownHelperCalls >= 1
import library from "./library.cjs";
console.log(library.run(100), new library.Node4(1, 2).getStart(), library.create(3).kind);
console.log(Object.entries(Object.getOwnPropertyDescriptors(library)).map(([name, it]) => [name, it.enumerable, it.configurable, typeof it.get, it.get && it.get.name].join()).join("\n"));
