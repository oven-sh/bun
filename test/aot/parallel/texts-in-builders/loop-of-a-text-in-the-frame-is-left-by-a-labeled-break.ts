// A labeled break and a labeled continue leave the inner loop of two, while one text grows in both loops and another is begun anew in every outer turn.
function table(rows: number, columns: number, stopRow: number, skipColumn: number): string {
    let all = "";
    outer: for (let row = 0; row < rows; row++) {
        let line = "r" + row + ":";
        for (let column = 0; column < columns; column++) {
            if (column === skipColumn) {
                all += "~";
                continue outer;
            }
            if (row === stopRow && column === 1) {
                all += line + "#";
                break outer;
            }
            line += column;
            all += ".";
        }
        all += line + ";";
    }
    return all;
}

function deed(rows: number, columns: number, stopRow: number, skipColumn: number) {
    console.log(table(rows, columns, stopRow, skipColumn));
}

deed(0, 0, -1, -1);
deed(3, 3, -1, -1);
deed(3, 3, 1, -1);
deed(3, 3, -1, 2);
deed(3, 3, 2, 0);
for (let turn = 0; turn < 3; turn++)
    deed(4, 4, turn + 1, 3 - turn);
console.log(table(30, 30, 29, -1).length);
