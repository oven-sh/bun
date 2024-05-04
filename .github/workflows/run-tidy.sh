rm -f did_fail format.log
echo "wow such fail" > format.log
echo 1 > did_fail
# bun build:tidy &2>1 | tee format.log || echo 1 > did_fail
# Upload format.log as github artifact for the workflow
echo "text_output=$(cat format.log || echo 0)" >> "$GITHUB_OUTPUT"
echo "did_fail=$(cat did_fail || echo 0)" >> "$GITHUB_OUTPUT"
echo "${{ github.event.number }}" > pr-number.txt