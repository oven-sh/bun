#!/usr/bin/env bun

import { $ } from "bun";

interface ReleaseInfo {
  publishedAt: string;
  tag: string;
}

interface Issue {
  number: number;
  closedAt: string;
  stateReason: string;
}

interface Reaction {
  content: string;
}

interface Comment {
  id: number;
}

/**
 * Get release information for a given tag
 */
async function getReleaseInfo(tag: string): Promise<ReleaseInfo> {
  try {
    const result = await $`gh release view ${tag} --json publishedAt,tagName`.json();
    return {
      publishedAt: result.publishedAt,
      tag: result.tagName,
    };
  } catch (error) {
    throw new Error(`Failed to get release info for ${tag}: ${error}`);
  }
}

/**
 * Count issues closed as completed since a given date
 */
async function countCompletedIssues(sinceDate: string): Promise<{ count: number; issues: number[] }> {
  try {
    const result =
      (await $`gh issue list --state closed --search "closed:>=${sinceDate} reason:completed" --limit 1000 --json number,closedAt,stateReason`.json()) as Issue[];

    const completedIssues = result.filter(issue => issue.stateReason === "COMPLETED");

    return {
      count: completedIssues.length,
      issues: completedIssues.map(issue => issue.number),
    };
  } catch (error) {
    throw new Error(`Failed to count completed issues: ${error}`);
  }
}

/**
 * Get positive reactions for an issue (👍, ❤️, 🎉, 🚀)
 */
async function getIssueReactions(issueNumber: number): Promise<number> {
  try {
    const reactions = (await $`gh api "repos/oven-sh/bun/issues/${issueNumber}/reactions"`.json()) as Reaction[];
    return reactions.filter(r => ["+1", "heart", "hooray", "rocket"].includes(r.content)).length;
  } catch {
    return 0;
  }
}

/**
 * Get positive reactions for all comments on an issue
 */
async function getCommentReactions(issueNumber: number): Promise<number> {
  try {
    const comments = (await $`gh api "repos/oven-sh/bun/issues/${issueNumber}/comments"`.json()) as Comment[];

    let totalReactions = 0;
    for (const comment of comments) {
      try {
        const reactions =
          (await $`gh api "repos/oven-sh/bun/issues/comments/${comment.id}/reactions"`.json()) as Reaction[];
        totalReactions += reactions.filter(r => ["+1", "heart", "hooray", "rocket"].includes(r.content)).length;
      } catch {
        // Skip if we can't get reactions for this comment
      }
    }

    return totalReactions;
  } catch {
    return 0;
  }
}

/**
 * Count total positive reactions for issues and their comments
 */
async function countReactions(issueNumbers: number[], verbose = false): Promise<number> {
  let totalReactions = 0;

  for (const issueNumber of issueNumbers) {
    if (verbose) {
      console.log(`Processing issue #${issueNumber}...`);
    }

    const [issueReactions, commentReactions] = await Promise.all([
      getIssueReactions(issueNumber),
      getCommentReactions(issueNumber),
    ]);

    const issueTotal = issueReactions + commentReactions;
    totalReactions += issueTotal;

    if (verbose && issueTotal > 0) {
      console.log(
        `  Issue #${issueNumber}: ${issueReactions} issue + ${commentReactions} comment = ${issueTotal} total`,
      );
    }

    // Small delay to avoid rate limiting
    await Bun.sleep(1);
  }

  return totalReactions;
}

/**
 * Main function to collect GitHub metrics
 */
async function main() {
  const args = process.argv.slice(2);
  const releaseTag = args[0];
  const verbose = args.includes("--verbose") || args.includes("-v");

  if (!releaseTag) {
    console.error("Usage: bun run scripts/github-metrics.ts <release-tag> [--verbose]");
    console.error("Example: bun run scripts/github-metrics.ts bun-v1.2.19");
    process.exit(1);
  }

  try {
    console.log(`📊 Collecting GitHub metrics since ${releaseTag}...`);

    // Get release date
    const releaseInfo = await getReleaseInfo(releaseTag);
    const releaseDate = releaseInfo.publishedAt.split("T")[0]; // Extract date part

    if (verbose) {
      console.log(`📅 Release date: ${releaseDate}`);
    }

    // Count completed issues
    console.log("🔍 Counting completed issues...");
    const { count: issueCount, issues: issueNumbers } = await countCompletedIssues(releaseDate);

    // Count reactions
    console.log("👍 Counting positive reactions...");
    const reactionCount = await countReactions(issueNumbers, verbose);

    // Display results
    console.log("\n📈 Results:");
    console.log(`Issues closed as completed since ${releaseTag}: ${issueCount}`);
    console.log(`Total positive reactions (👍❤️🎉🚀): ${reactionCount}`);

    if (issueCount > 0) {
      console.log(`Average reactions per completed issue: ${(reactionCount / issueCount).toFixed(1)}`);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Run if this script is executed directly
if (import.meta.main) {
  main();
}
