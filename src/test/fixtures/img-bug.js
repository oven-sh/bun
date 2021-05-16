function hey() {
  const well = {
    baz: function () {},
  };
}

function yo() {
  const hi = {
    yo: function () {},
  };
}

// function yo() {
//   const hi = {
//     yo: function () {},
//   };
// }

// This bug is the same as function-scope-bug.jsx, except this time,
// it's specific to scopes created in property definitions
// That means, either arrow functions or non-arrow functions

// ESBUILD
// Scope: (5 -1) | Scope (5, -100)
// Scope: (6 12) | Scope (6, 12)
// Scope: (7 15) | Scope (7, 15)
// Scope: (6 43) | Scope (6, 43)
// Scope: (7 55) | Scope (7, 55)
// Scope: (6 78) | Scope (6, 78)
// Scope: (7 81) | Scope (7, 81)

// Scope (6, 106)
// Scope (7, 118)

// Scope: (5 -1)  | Scope (5, -100)
// Scope: (6 12)  | Scope (6, 12)
// Scope: (7 15)  | Scope (7, 15)
// Scope: (6 43)  | Scope (6, 43)
// Scope: (7 55)  | Scope (7, 55)
// Scope: (6 78)  | Scope (6, 78)
// Scope: (7 81)  | Scope (7, 81)
// Scope: (6 106) | Scope (6, 106)
// Scope: (7 118) | Scope (7, 118)

// ESBUILD

// Scope: (5 -1)
// Scope: (6 12)
// Scope: (7 15)
// Scope: (6 43)
// Scope: (7 55)
// Scope: (6 78)
// Scope: (7 81)
// Scope: (6 106)
// Scope: (7 118)
// Scope: (6 141)
// Scope: (7 144)
// Scope: (6 169)
// Scope: (7 181)
