export class Pipeline {
  /**
   * @param {number} [limit]
   * @link https://buildkite.com/docs/pipelines/command-step#retry-attributes
   */
  static getRetry = (limit: number = 0) => {
    return {
      automatic: [
        { exit_status: 1, limit },
        { exit_status: -1, limit: 3 },
        { exit_status: 255, limit: 3 },
        { signal_reason: "agent_stop", limit: 3 },
      ],
    };
  };
}

export type PipelineOptions = {
  buildId?: string;
  buildImages?: boolean;
  publishImages?: boolean;
  skipTests?: boolean;
};
export type PipelineTargetSteps<Step> = {
  getBuildVendorStep: () => Step;
  getBuildCppStep: () => Step;
  getBuildZigStep: () => Step;
  getBuildBunStep: () => Step;
  getTestBunStep: () => Step;
};
