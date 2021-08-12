// The bug is:
// when there are even number of scopes which have property accesses that themselves declare scopes,

// the scope counter is wrong, causing an invariant check to fail.
class f {}
prop[class {}];
class a {}

// prop[class {}];

// prop[
//   function (match) {
//     return 0;
//   }
// ];
