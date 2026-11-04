export const act = () => {
  jest.useFakeTimers();
  let hit = 0;
  setTimeout(() => hit++, 1000);
  jest.advanceTimersByTime(5000);
  console.log("hit", hit);
  return () => jest.useRealTimers();
};
