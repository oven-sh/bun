// RUN: lower

// What a variable without a written type holds is found by looking at what is stored to it. A question that is asked anew along every path through a circle of stores does not end.

// FILE: main.ts
declare const console: { log(...values: unknown[]): void };
function f(x: string) { let s = x; s = s.replace("0", "1").replace("1", "2").replace("2", "3").replace("3", "4").replace("4", "5").replace("5", "6").replace("6", "7").replace("7", "8").replace("8", "9").replace("9", "10").replace("10", "11").replace("11", "12").replace("12", "13").replace("13", "14").replace("14", "15").replace("15", "16").replace("16", "17").replace("17", "18").replace("18", "19").replace("19", "20").replace("20", "21").replace("21", "22").replace("22", "23").replace("23", "24").replace("24", "25").replace("25", "26").replace("26", "27").replace("27", "28").replace("28", "29").replace("29", "30").replace("30", "31").replace("31", "32").replace("32", "33").replace("33", "34").replace("34", "35").replace("35", "36").replace("36", "37").replace("37", "38").replace("38", "39").replace("39", "40").replace("40", "41").replace("41", "42").replace("42", "43").replace("43", "44").replace("44", "45").replace("45", "46").replace("46", "47").replace("47", "48").replace("48", "49").replace("49", "50").replace("50", "51").replace("51", "52").replace("52", "53").replace("53", "54").replace("54", "55").replace("55", "56").replace("56", "57").replace("57", "58").replace("58", "59").replace("59", "60"); return s; }
console.log(f("0"));
