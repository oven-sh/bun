// STATISTIC: UnrolledLoopsForIndexingType >= 1
'use strict';
const depths = JSON.parse('[0.0,9.25,18.5,2.5,11.75,21.0,5.0,14.25,23.5,7.5,16.75,0.75,10.0,19.25,3.25,12.5,21.75,5.75,15.0,24.25,8.25,17.5,1.5,10.75,20.0,4.0,13.25,22.5,6.5,15.75,25.0,9.0,18.25,2.25,11.5,20.75,4.75,14.0,23.25,7.25,16.5,0.5,9.75,19.0,3.0,12.25,21.5,5.5,14.75,24.0,8.0,17.25,1.25,10.5,19.75,3.75,13.0,22.25,6.25,15.5,24.75,8.75,18.0,2.0]');
function insist(condition, message) { if (!condition) throw new Error(message); }
function sound(t) { let total = t & 1; for (let i = 0; i < 64; i++) { insist(depths[i] >= 0, `below the ground at ${i}: ${depths[i]}`); total += depths[i]; } return total; }
let sum = 0; for (let t = 0; t < 7; t++) sum = (sum + sound(t)) % 1000003;
console.log(Math.floor(sum), sound(0), sound(1));
