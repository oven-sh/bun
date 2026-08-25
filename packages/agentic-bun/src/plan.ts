/**
 * Prompt construction and goal decomposition.
 *
 * There is deliberately no planner here: when the user asks for the goal to be
 * split, we ask the model to do it in one throwaway headless call and parse the
 * list it prints. Everything else in this file is string building.
 */

export interface AgentSpec {
  /** Short stable label used to prefix streamed output, e.g. "a1". */
  id: string;
  task: string;
}

export interface PromptContext {
  goal: string;
  cwd: string;
  spec: AgentSpec;
  index: number;
  all: AgentSpec[];
}

/** The prompt handed to one agent. Single-agent runs skip the coordination section. */
export function buildAgentPrompt({ goal, cwd, spec, index, all }: PromptContext): string {
  const lines: string[] = [];

  if (all.length === 1) {
    lines.push(`Task: ${goal}`);
    if (spec.task && spec.task !== goal) lines.push("", `Specifically: ${spec.task}`);
    lines.push("", `Work inside ${cwd}.`);
  } else {
    lines.push(`You are agent ${index + 1} of ${all.length} working in parallel on one shared objective.`);
    lines.push("", "OBJECTIVE", goal);
    lines.push("", "YOUR TASK", spec.task);
    lines.push("", "TASKS OWNED BY THE OTHER AGENTS (do not do these)");
    for (const [i, other] of all.entries()) {
      if (i === index) continue;
      lines.push(`  ${i + 1}. ${other.task}`);
    }
    lines.push(
      "",
      "RULES",
      `- Work inside ${cwd}.`,
      "- Do only your task. If your task needs something another agent owns, assume it will exist and note the assumption in your summary instead of doing their work.",
      "- The other agents are editing this same working tree right now. Do not run repo-wide destructive commands (git checkout/reset/clean/stash, mass reformat, dependency reinstall) and do not commit or push.",
      "- Prefer edits scoped to the files your task names.",
    );
  }

  lines.push(
    "",
    "When you are finished, print a short summary: what you changed, which files you touched, and anything you could not do.",
  );
  return lines.join("\n");
}

export function buildPlannerPrompt(goal: string, count: number, cwd: string): string {
  return [
    `Split the objective below into exactly ${count} independent tasks that ${count} engineers could work on at the same time in ${cwd} without editing the same files.`,
    "",
    "OBJECTIVE",
    goal,
    "",
    `Reply with ONLY a JSON array of exactly ${count} strings. No prose, no markdown fences, no numbering. Each string is one self-contained task description.`,
  ].join("\n");
}

/**
 * Pull a task list out of a model reply. Tries a JSON array first (with or
 * without surrounding chatter or code fences), then falls back to numbered or
 * bulleted lines, which is what models emit when they ignore the format ask.
 */
export function extractTaskList(raw: string): string[] {
  const fromJson = extractJsonArray(raw);
  if (fromJson.length) return fromJson;

  const bulleted: string[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.{3,})$/);
    if (m) bulleted.push(m[1].trim().replace(/^["'`]|["'`,]+$/g, ""));
  }
  return bulleted;
}

function extractJsonArray(raw: string): string[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map(v => v.trim());
  } catch {
    return [];
  }
}

export function toSpecs(tasks: string[]): AgentSpec[] {
  return tasks.map((task, i) => ({ id: `a${i + 1}`, task: task.trim() }));
}
