namespace N {
  export let lonely = "member";
  export const kind = eval("typeof lonely");
  export let said = "";
  try { eval("lonely"); said = "read"; } catch (e) { said = (e as Error).name; }
}
console.log(N.kind, N.said);
