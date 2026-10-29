declare global {
  interface OnlyInDeclareGlobal {
    a: number;
  }
}
export default OnlyInDeclareGlobal;
console.log("in declare global");
