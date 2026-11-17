// @ts-nocheck
export let ran = "no";
global
{
  ran = "yes";
}
console.log(ran, typeof global);
