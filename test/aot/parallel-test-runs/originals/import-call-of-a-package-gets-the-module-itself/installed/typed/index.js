export const seen = () => {
  console.log("call");
  const answer = import("../../dep.js");
  console.log("behind the call");
  return answer;
};
