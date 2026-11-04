export let value = 1;
export let act = () => "first";
let turns = 0;
export function change() {
  turns++;
  value = turns % 2 ? "text " + turns : turns;
  act = turns % 2 ? () => "odd" : () => "even";
}
