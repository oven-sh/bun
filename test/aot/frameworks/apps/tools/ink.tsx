import { Box, Text, render, useApp } from "ink";
import React, { useEffect, useState } from "react";

const Counter = ({ until }: { until: number }) => {
  const { exit } = useApp();
  const [counter, setCounter] = useState(0);
  useEffect(() => {
    if (counter < until) setCounter(counter + 1);
    else exit();
  }, [counter, until, exit]);
  return (
    <Box flexDirection="column" borderStyle="round" width={24}>
      <Text color="green">{counter} tests passed</Text>
      <Box justifyContent="space-between">
        <Text bold>left</Text>
        <Text dimColor>right</Text>
      </Box>
    </Box>
  );
};
const { waitUntilExit } = render(<Counter until={3} />, {
  debug: true,
  patchConsole: false,
  exitOnCtrlC: false,
});
await waitUntilExit();
console.log("done");
