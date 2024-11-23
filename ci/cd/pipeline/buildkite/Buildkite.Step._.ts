import { Agent } from "../../agent/Agent";

/**
 * @link https://buildkite.com/docs/pipelines/command-step
 */
export type BuildkiteStep = {
  key: string;
  label?: string;
  agents?: Agent;
  env?: Record<string, string | undefined>;
  command?: string;
  depends_on?: string[];
  retry?: {
    automatic: Array<{
      exit_status?: number | undefined;
      limit: number;
      signal_reason?: string | undefined;
    }>;
  };
  cancel_on_build_failing?: boolean;
  soft_fail?: boolean | Record<string, number>[];
  parallelism?: number;
  concurrency?: number;
  concurrency_group?: string;
  priority?: number;
  timeout_in_minutes?: number;
  group?: string;
  steps?: BuildkiteStep[];
};
