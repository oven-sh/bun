// An async function, an async arrow and an async generator with more parameters than there are registers for them set a late one to null behind an await.
function fold(value) {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
async function later(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) {
  let got = await (a + b);
  got = (got + (await (v0 + v1))) | 0;
  v11 = null;
  got = (got + (await (v2 + v3))) | 0;
  return (got + v4 + v5 + v6 + v7 + v8 + v9 + fold(v11)) | 0;
}
const arrow = async (a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) => {
  let got = await (a + b);
  v11 = null;
  got = (got + (await (v0 + v1 + v2 + v3))) | 0;
  return (got + v4 + v5 + v6 + v7 + v8 + v9 + fold(v11)) | 0;
};
async function* stream(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v11) {
  yield a + b;
  await null;
  v11 = null;
  yield v0 + v1 + v2 + v3;
  yield (v4 + v5 + v6 + v7 + v8 + v9 + fold(v11)) | 0;
}
let hash = 0;
for (let i = 0; i < 21; i++) hash = (Math.imul(hash, 31) + (await later(i, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, { id: i }))) | 0;
console.log("an async function", hash >>> 0);
for (let i = 0; i < 21; i++) hash = (Math.imul(hash, 31) + (await arrow(i, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, { id: i }))) | 0;
console.log("an async arrow", hash >>> 0);
for (let i = 0; i < 21; i++) for await (const value of stream(i, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, { id: i })) hash = (Math.imul(hash, 31) + value) | 0;
console.log("an async generator", hash >>> 0);
const all = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(i => later(i, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, { id: i })));
console.log("eight at once", all.join());
