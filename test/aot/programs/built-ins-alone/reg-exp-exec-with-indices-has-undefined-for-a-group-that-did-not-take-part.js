const match = /(?<first>a)(?<other>x)?/d.exec("banana");
console.log(match.indices[0][0] + 1, match.indices[2] === undefined, match.indices.groups.first[1] + 1, match.indices.groups.other === undefined);
