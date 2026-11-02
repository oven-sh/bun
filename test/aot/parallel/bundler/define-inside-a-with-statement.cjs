// Flags: --define=process.env.NODE_ENV="production" --define=FLAG=false --define=LEVEL=3 --define=NOTHING=null --define=ABSENT=undefined --define=CONFIG={"a":[1,2],"b":{"c":null}} --define=process.env.ALIAS=holder.member --feature=ON
with ({ FLAG: "from the object" }) {
  console.log(FLAG);
}
console.log(FLAG);

/* Output:
from the object
false
*/
