const holed = JSON.parse('[1,0,2]'); holed[6] = 3; holed[8] = 0;
console.log(JSON.stringify(holed.filter(Boolean)), holed.length);
