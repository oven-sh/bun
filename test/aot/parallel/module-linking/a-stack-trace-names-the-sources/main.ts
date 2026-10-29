import { thrower } from "./lib";
function caller(): never {
  return thrower("boom");
}
function outer() { try { caller(); } catch (e) { console.log((e as Error).stack!.replace(/[^\s(]*[\\/]/g, "")); } }
outer();
