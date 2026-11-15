interface Road<Base extends string> { path: Base; below?: Road<`${Base}/${string}`>[] }
const root: Road<"/top"> = { path: "/top", below: [{ path: "/top/a", below: [{ path: "/top/a/b", below: [{ path: "/top/a/b/c", below: [{ path: "/top/a/b/c/d" }] }] }] }] };
console.log(root.path, root.below?.length, root.below?.[0].below?.[0].below?.[0].below?.[0].path);
export {};
