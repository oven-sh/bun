const bound = Boolean.bind(null);
console.log(JSON.stringify(JSON.parse('[0,1,"","x"]').filter(bound)));
