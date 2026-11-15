const rows = JSON.parse('[[true,false,true],[false,false],[true]]');
console.log(rows.reduce((sum, row) => sum + row.filter(Boolean).length, 0));
