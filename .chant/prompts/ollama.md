---
name: ollama
purpose: Optimized prompt for local LLM execution
---

# Execute Spec: {{spec.title}}

{{spec.description}}

## Tools Available

- `read_file(path)` - Read file contents
- `write_file(path, content)` - Write/create file
- `run_command(command)` - Run shell command
- `list_files(pattern)` - List files matching glob
- `task_complete(summary)` - Signal task done

## Steps

1. **Read** target files first using read_file
2. **Implement** changes using write_file
3. **Format**: run_command("just fmt")
4. **Lint**: run_command("just lint")
5. **Test**: run_command("just test")
6. **Check** acceptance criteria in {{spec.path}}
7. **Commit**: run_command("git add . && git commit -m 'chant({{spec.id}}): description'")
8. **Complete**: task_complete("summary of what was done")

## Rules

- Read before writing
- Use `just` commands, not cargo directly
- Only modify files in target_files
- Commit message must start with chant({{spec.id}})
