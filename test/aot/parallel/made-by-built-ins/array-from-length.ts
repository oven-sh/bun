function sumOf(text: string): string {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
  return text.length + ":" + sum;
}
function joinIntegers(list: number[]): string {
  let text = "";
  for (const value of list) text += "id" + (value | 0) + ",";
  return text;
}
console.log(joinIntegers([0, 9, 10]));
console.log(sumOf(joinIntegers(Array.from({ length: 3000 }, (_, i) => i * 37))));
