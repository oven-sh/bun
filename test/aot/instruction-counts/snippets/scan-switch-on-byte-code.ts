// goes by a switch of 21 cases on every byte of a string by charCodeAt
const operations = 100;
const pattern = '{"name":[true,false,null,-12.5],"x":{}} ';
let text = "";
for (let i = 0; i < operations - 0; i++) text += pattern[i % pattern.length];
let total = 0;

kernel: {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    switch (text.charCodeAt(i)) {
      case 123:
        n += 1;
        break;
      case 125:
        n += 2;
        break;
      case 91:
        n += 3;
        break;
      case 93:
        n += 4;
        break;
      case 58:
        n += 5;
        break;
      case 44:
        n += 6;
        break;
      case 34:
        n += 7;
        break;
      case 116:
        n += 8;
        break;
      case 102:
        n += 9;
        break;
      case 110:
        n += 10;
        break;
      case 45:
        n += 11;
        break;
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        n += 12;
        break;
      default:
        n += 13;
    }
  }
  total += n;
}

console.log(total);
