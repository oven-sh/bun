const mixed = JSON.parse('[0,1,null,"a","",true,false,{},[],-0,1.5]');
console.log(JSON.stringify(mixed.filter(Boolean)), mixed.length);
