const makeSetOf1 = () => new Set(["only"]);
const makeSetOf8 = () => new Set(["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "key-1", "key-2", "key-3", "key-4", "key-5", "key-6", "key-7"]);
const makeSetOf9 = () => new Set(["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "key-1", "key-2", "key-3", "key-4", "key-5", "key-6", "key-7", "key-8"]);
const makeSetOf255 = () => new Set(["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "key-1", "key-2", "key-3", "key-4", "key-5", "key-6", "key-7", "key-8", "key-9", "key-10", "key-11", "key-12", "key-13", "key-14", "key-15", "key-16", "key-17", "key-18", "key-19", "key-20", "key-21", "key-22", "key-23", "key-24", "key-25", "key-26", "key-27", "key-28", "key-29", "key-30", "key-31", "key-32", "key-33", "key-34", "key-35", "key-36", "key-37", "key-38", "key-39", "key-40", "key-41", "key-42", "key-43", "key-44", "key-45", "key-46", "key-47", "key-48", "key-49", "key-50", "key-51", "key-52", "key-53", "key-54", "key-55", "key-56", "key-57", "key-58", "key-59", "key-60", "key-61", "key-62", "key-63", "key-64", "key-65", "key-66", "key-67", "key-68", "key-69", "key-70", "key-71", "key-72", "key-73", "key-74", "key-75", "key-76", "key-77", "key-78", "key-79", "key-80", "key-81", "key-82", "key-83", "key-84", "key-85", "key-86", "key-87", "key-88", "key-89", "key-90", "key-91", "key-92", "key-93", "key-94", "key-95", "key-96", "key-97", "key-98", "key-99", "key-100", "key-101", "key-102", "key-103", "key-104", "key-105", "key-106", "key-107", "key-108", "key-109", "key-110", "key-111", "key-112", "key-113", "key-114", "key-115", "key-116", "key-117", "key-118", "key-119", "key-120", "key-121", "key-122", "key-123", "key-124", "key-125", "key-126", "key-127", "key-128", "key-129", "key-130", "key-131", "key-132", "key-133", "key-134", "key-135", "key-136", "key-137", "key-138", "key-139", "key-140", "key-141", "key-142", "key-143", "key-144", "key-145", "key-146", "key-147", "key-148", "key-149", "key-150", "key-151", "key-152", "key-153", "key-154", "key-155", "key-156", "key-157", "key-158", "key-159", "key-160", "key-161", "key-162", "key-163", "key-164", "key-165", "key-166", "key-167", "key-168", "key-169", "key-170", "key-171", "key-172", "key-173", "key-174", "key-175", "key-176", "key-177", "key-178", "key-179", "key-180", "key-181", "key-182", "key-183", "key-184", "key-185", "key-186", "key-187", "key-188", "key-189", "key-190", "key-191", "key-192", "key-193", "key-194", "key-195", "key-196", "key-197", "key-198", "key-199", "key-200", "key-201", "key-202", "key-203", "key-204", "key-205", "key-206", "key-207", "key-208", "key-209", "key-210", "key-211", "key-212", "key-213", "key-214", "key-215", "key-216", "key-217", "key-218", "key-219", "key-220", "key-221", "key-222", "key-223", "key-224", "key-225", "key-226", "key-227", "key-228", "key-229", "key-230", "key-231", "key-232", "key-233", "key-234", "key-235", "key-236", "key-237", "key-238", "key-239", "key-240", "key-241", "key-242", "key-243", "key-244", "key-245", "key-246", "key-247", "key-248", "key-249", "key-250", "key-251", "key-252", "key-253", "key-254"]);
const makeSetOf300 = () => new Set(["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "key-1", "key-2", "key-3", "key-4", "key-5", "key-6", "key-7", "key-8", "key-9", "key-10", "key-11", "key-12", "key-13", "key-14", "key-15", "key-16", "key-17", "key-18", "key-19", "key-20", "key-21", "key-22", "key-23", "key-24", "key-25", "key-26", "key-27", "key-28", "key-29", "key-30", "key-31", "key-32", "key-33", "key-34", "key-35", "key-36", "key-37", "key-38", "key-39", "key-40", "key-41", "key-42", "key-43", "key-44", "key-45", "key-46", "key-47", "key-48", "key-49", "key-50", "key-51", "key-52", "key-53", "key-54", "key-55", "key-56", "key-57", "key-58", "key-59", "key-60", "key-61", "key-62", "key-63", "key-64", "key-65", "key-66", "key-67", "key-68", "key-69", "key-70", "key-71", "key-72", "key-73", "key-74", "key-75", "key-76", "key-77", "key-78", "key-79", "key-80", "key-81", "key-82", "key-83", "key-84", "key-85", "key-86", "key-87", "key-88", "key-89", "key-90", "key-91", "key-92", "key-93", "key-94", "key-95", "key-96", "key-97", "key-98", "key-99", "key-100", "key-101", "key-102", "key-103", "key-104", "key-105", "key-106", "key-107", "key-108", "key-109", "key-110", "key-111", "key-112", "key-113", "key-114", "key-115", "key-116", "key-117", "key-118", "key-119", "key-120", "key-121", "key-122", "key-123", "key-124", "key-125", "key-126", "key-127", "key-128", "key-129", "key-130", "key-131", "key-132", "key-133", "key-134", "key-135", "key-136", "key-137", "key-138", "key-139", "key-140", "key-141", "key-142", "key-143", "key-144", "key-145", "key-146", "key-147", "key-148", "key-149", "key-150", "key-151", "key-152", "key-153", "key-154", "key-155", "key-156", "key-157", "key-158", "key-159", "key-160", "key-161", "key-162", "key-163", "key-164", "key-165", "key-166", "key-167", "key-168", "key-169", "key-170", "key-171", "key-172", "key-173", "key-174", "key-175", "key-176", "key-177", "key-178", "key-179", "key-180", "key-181", "key-182", "key-183", "key-184", "key-185", "key-186", "key-187", "key-188", "key-189", "key-190", "key-191", "key-192", "key-193", "key-194", "key-195", "key-196", "key-197", "key-198", "key-199", "key-200", "key-201", "key-202", "key-203", "key-204", "key-205", "key-206", "key-207", "key-208", "key-209", "key-210", "key-211", "key-212", "key-213", "key-214", "key-215", "key-216", "key-217", "key-218", "key-219", "key-220", "key-221", "key-222", "key-223", "key-224", "key-225", "key-226", "key-227", "key-228", "key-229", "key-230", "key-231", "key-232", "key-233", "key-234", "key-235", "key-236", "key-237", "key-238", "key-239", "key-240", "key-241", "key-242", "key-243", "key-244", "key-245", "key-246", "key-247", "key-248", "key-249", "key-250", "key-251", "key-252", "key-253", "key-254", "key-255", "key-256", "key-257", "key-258", "key-259", "key-260", "key-261", "key-262", "key-263", "key-264", "key-265", "key-266", "key-267", "key-268", "key-269", "key-270", "key-271", "key-272", "key-273", "key-274", "key-275", "key-276", "key-277", "key-278", "key-279", "key-280", "key-281", "key-282", "key-283", "key-284", "key-285", "key-286", "key-287", "key-288", "key-289", "key-290", "key-291", "key-292", "key-293", "key-294", "key-295", "key-296", "key-297", "key-298", "key-299"]);
const makeMapOf1 = () => new Map<string, unknown>([["only", "v"]]);
const makeMapOf8 = () => new Map<string, unknown>([["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", undefined], ["key-1", null], ["key-2", true], ["key-3", false], ["key-4", ""], ["key-5", "a"], ["key-6", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-7", 7]]);
const makeMapOf9 = () => new Map<string, unknown>([["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", undefined], ["key-1", null], ["key-2", true], ["key-3", false], ["key-4", -0], ["key-5", NaN], ["key-6", 1e300], ["key-7", ""], ["key-8", "a"]]);
const makeMapOf255 = () => new Map<string, unknown>([["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", undefined], ["key-1", null], ["key-2", true], ["key-3", false], ["key-4", -0], ["key-5", NaN], ["key-6", 1e300], ["key-7", ""], ["key-8", "a"], ["key-9", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-10", 7], ["key-11", undefined], ["key-12", null], ["key-13", true], ["key-14", false], ["key-15", -0], ["key-16", NaN], ["key-17", 1e300], ["key-18", ""], ["key-19", "a"], ["key-20", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-21", 7], ["key-22", undefined], ["key-23", null], ["key-24", true], ["key-25", false], ["key-26", -0], ["key-27", NaN], ["key-28", 1e300], ["key-29", ""], ["key-30", "a"], ["key-31", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-32", 7], ["key-33", undefined], ["key-34", null], ["key-35", true], ["key-36", false], ["key-37", -0], ["key-38", NaN], ["key-39", 1e300], ["key-40", ""], ["key-41", "a"], ["key-42", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-43", 7], ["key-44", undefined], ["key-45", null], ["key-46", true], ["key-47", false], ["key-48", -0], ["key-49", NaN], ["key-50", 1e300], ["key-51", ""], ["key-52", "a"], ["key-53", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-54", 7], ["key-55", undefined], ["key-56", null], ["key-57", true], ["key-58", false], ["key-59", -0], ["key-60", NaN], ["key-61", 1e300], ["key-62", ""], ["key-63", "a"], ["key-64", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-65", 7], ["key-66", undefined], ["key-67", null], ["key-68", true], ["key-69", false], ["key-70", -0], ["key-71", NaN], ["key-72", 1e300], ["key-73", ""], ["key-74", "a"], ["key-75", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-76", 7], ["key-77", undefined], ["key-78", null], ["key-79", true], ["key-80", false], ["key-81", -0], ["key-82", NaN], ["key-83", 1e300], ["key-84", ""], ["key-85", "a"], ["key-86", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-87", 7], ["key-88", undefined], ["key-89", null], ["key-90", true], ["key-91", false], ["key-92", -0], ["key-93", NaN], ["key-94", 1e300], ["key-95", ""], ["key-96", "a"], ["key-97", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-98", 7], ["key-99", undefined], ["key-100", null], ["key-101", true], ["key-102", false], ["key-103", -0], ["key-104", NaN], ["key-105", 1e300], ["key-106", ""], ["key-107", "a"], ["key-108", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-109", 7], ["key-110", undefined], ["key-111", null], ["key-112", true], ["key-113", false], ["key-114", -0], ["key-115", NaN], ["key-116", 1e300], ["key-117", ""], ["key-118", "a"], ["key-119", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-120", 7], ["key-121", undefined], ["key-122", null], ["key-123", true], ["key-124", false], ["key-125", -0], ["key-126", NaN], ["key-127", 1e300], ["key-128", ""], ["key-129", "a"], ["key-130", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-131", 7], ["key-132", undefined], ["key-133", null], ["key-134", true], ["key-135", false], ["key-136", -0], ["key-137", NaN], ["key-138", 1e300], ["key-139", ""], ["key-140", "a"], ["key-141", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-142", 7], ["key-143", undefined], ["key-144", null], ["key-145", true], ["key-146", false], ["key-147", -0], ["key-148", NaN], ["key-149", 1e300], ["key-150", ""], ["key-151", "a"], ["key-152", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-153", 7], ["key-154", undefined], ["key-155", null], ["key-156", true], ["key-157", false], ["key-158", -0], ["key-159", NaN], ["key-160", 1e300], ["key-161", ""], ["key-162", "a"], ["key-163", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-164", 7], ["key-165", undefined], ["key-166", null], ["key-167", true], ["key-168", false], ["key-169", -0], ["key-170", NaN], ["key-171", 1e300], ["key-172", ""], ["key-173", "a"], ["key-174", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-175", 7], ["key-176", undefined], ["key-177", null], ["key-178", true], ["key-179", false], ["key-180", -0], ["key-181", NaN], ["key-182", 1e300], ["key-183", ""], ["key-184", "a"], ["key-185", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-186", 7], ["key-187", undefined], ["key-188", null], ["key-189", true], ["key-190", false], ["key-191", -0], ["key-192", NaN], ["key-193", 1e300], ["key-194", ""], ["key-195", "a"], ["key-196", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-197", 7], ["key-198", undefined], ["key-199", null], ["key-200", true], ["key-201", false], ["key-202", -0], ["key-203", NaN], ["key-204", 1e300], ["key-205", ""], ["key-206", "a"], ["key-207", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-208", 7], ["key-209", undefined], ["key-210", null], ["key-211", true], ["key-212", false], ["key-213", -0], ["key-214", NaN], ["key-215", 1e300], ["key-216", ""], ["key-217", "a"], ["key-218", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-219", 7], ["key-220", undefined], ["key-221", null], ["key-222", true], ["key-223", false], ["key-224", -0], ["key-225", NaN], ["key-226", 1e300], ["key-227", ""], ["key-228", "a"], ["key-229", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-230", 7], ["key-231", undefined], ["key-232", null], ["key-233", true], ["key-234", false], ["key-235", -0], ["key-236", NaN], ["key-237", 1e300], ["key-238", ""], ["key-239", "a"], ["key-240", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-241", 7], ["key-242", undefined], ["key-243", null], ["key-244", true], ["key-245", false], ["key-246", -0], ["key-247", NaN], ["key-248", 1e300], ["key-249", ""], ["key-250", "a"], ["key-251", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-252", 7], ["key-253", undefined], ["key-254", null]]);
const makeMapOf300 = () => new Map<string, unknown>([["long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "a"], ["key-1", ""], ["key-2", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-3", "b"], ["key-4", "a"], ["key-5", ""], ["key-6", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-7", "b"], ["key-8", "a"], ["key-9", ""], ["key-10", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-11", "b"], ["key-12", "a"], ["key-13", ""], ["key-14", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-15", "b"], ["key-16", "a"], ["key-17", ""], ["key-18", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-19", "b"], ["key-20", "a"], ["key-21", ""], ["key-22", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-23", "b"], ["key-24", "a"], ["key-25", ""], ["key-26", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-27", "b"], ["key-28", "a"], ["key-29", ""], ["key-30", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-31", "b"], ["key-32", "a"], ["key-33", ""], ["key-34", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-35", "b"], ["key-36", "a"], ["key-37", ""], ["key-38", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-39", "b"], ["key-40", "a"], ["key-41", ""], ["key-42", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-43", "b"], ["key-44", "a"], ["key-45", ""], ["key-46", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-47", "b"], ["key-48", "a"], ["key-49", ""], ["key-50", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-51", "b"], ["key-52", "a"], ["key-53", ""], ["key-54", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-55", "b"], ["key-56", "a"], ["key-57", ""], ["key-58", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-59", "b"], ["key-60", "a"], ["key-61", ""], ["key-62", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-63", "b"], ["key-64", "a"], ["key-65", ""], ["key-66", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-67", "b"], ["key-68", "a"], ["key-69", ""], ["key-70", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-71", "b"], ["key-72", "a"], ["key-73", ""], ["key-74", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-75", "b"], ["key-76", "a"], ["key-77", ""], ["key-78", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-79", "b"], ["key-80", "a"], ["key-81", ""], ["key-82", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-83", "b"], ["key-84", "a"], ["key-85", ""], ["key-86", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-87", "b"], ["key-88", "a"], ["key-89", ""], ["key-90", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-91", "b"], ["key-92", "a"], ["key-93", ""], ["key-94", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-95", "b"], ["key-96", "a"], ["key-97", ""], ["key-98", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-99", "b"], ["key-100", "a"], ["key-101", ""], ["key-102", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-103", "b"], ["key-104", "a"], ["key-105", ""], ["key-106", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-107", "b"], ["key-108", "a"], ["key-109", ""], ["key-110", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-111", "b"], ["key-112", "a"], ["key-113", ""], ["key-114", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-115", "b"], ["key-116", "a"], ["key-117", ""], ["key-118", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-119", "b"], ["key-120", "a"], ["key-121", ""], ["key-122", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-123", "b"], ["key-124", "a"], ["key-125", ""], ["key-126", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-127", "b"], ["key-128", "a"], ["key-129", ""], ["key-130", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-131", "b"], ["key-132", "a"], ["key-133", ""], ["key-134", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-135", "b"], ["key-136", "a"], ["key-137", ""], ["key-138", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-139", "b"], ["key-140", "a"], ["key-141", ""], ["key-142", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-143", "b"], ["key-144", "a"], ["key-145", ""], ["key-146", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-147", "b"], ["key-148", "a"], ["key-149", ""], ["key-150", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-151", "b"], ["key-152", "a"], ["key-153", ""], ["key-154", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-155", "b"], ["key-156", "a"], ["key-157", ""], ["key-158", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-159", "b"], ["key-160", "a"], ["key-161", ""], ["key-162", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-163", "b"], ["key-164", "a"], ["key-165", ""], ["key-166", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-167", "b"], ["key-168", "a"], ["key-169", ""], ["key-170", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-171", "b"], ["key-172", "a"], ["key-173", ""], ["key-174", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-175", "b"], ["key-176", "a"], ["key-177", ""], ["key-178", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-179", "b"], ["key-180", "a"], ["key-181", ""], ["key-182", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-183", "b"], ["key-184", "a"], ["key-185", ""], ["key-186", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-187", "b"], ["key-188", "a"], ["key-189", ""], ["key-190", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-191", "b"], ["key-192", "a"], ["key-193", ""], ["key-194", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-195", "b"], ["key-196", "a"], ["key-197", ""], ["key-198", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-199", "b"], ["key-200", "a"], ["key-201", ""], ["key-202", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-203", "b"], ["key-204", "a"], ["key-205", ""], ["key-206", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-207", "b"], ["key-208", "a"], ["key-209", ""], ["key-210", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-211", "b"], ["key-212", "a"], ["key-213", ""], ["key-214", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-215", "b"], ["key-216", "a"], ["key-217", ""], ["key-218", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-219", "b"], ["key-220", "a"], ["key-221", ""], ["key-222", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-223", "b"], ["key-224", "a"], ["key-225", ""], ["key-226", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-227", "b"], ["key-228", "a"], ["key-229", ""], ["key-230", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-231", "b"], ["key-232", "a"], ["key-233", ""], ["key-234", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-235", "b"], ["key-236", "a"], ["key-237", ""], ["key-238", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-239", "b"], ["key-240", "a"], ["key-241", ""], ["key-242", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-243", "b"], ["key-244", "a"], ["key-245", ""], ["key-246", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-247", "b"], ["key-248", "a"], ["key-249", ""], ["key-250", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-251", "b"], ["key-252", "a"], ["key-253", ""], ["key-254", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-255", "b"], ["key-256", "a"], ["key-257", ""], ["key-258", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-259", "b"], ["key-260", "a"], ["key-261", ""], ["key-262", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-263", "b"], ["key-264", "a"], ["key-265", ""], ["key-266", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-267", "b"], ["key-268", "a"], ["key-269", ""], ["key-270", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-271", "b"], ["key-272", "a"], ["key-273", ""], ["key-274", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-275", "b"], ["key-276", "a"], ["key-277", ""], ["key-278", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-279", "b"], ["key-280", "a"], ["key-281", ""], ["key-282", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-283", "b"], ["key-284", "a"], ["key-285", ""], ["key-286", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-287", "b"], ["key-288", "a"], ["key-289", ""], ["key-290", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-291", "b"], ["key-292", "a"], ["key-293", ""], ["key-294", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-295", "b"], ["key-296", "a"], ["key-297", ""], ["key-298", "long-value-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"], ["key-299", "b"]]);
const makeSetNotAscii = () => new Set(["plain", "\u00e9", "other"]);
const makeMapNotAscii = () => new Map<string, unknown>([["plain", 1], ["\u00e9", "a"], ["other", null]]);
const makeSetComputed = () => new Set(["plain", "computed-" + Number("2"), "other"]);
const makeMapComputed = () => new Map<string, unknown>([["plain", 1], ["computed-" + Number("2"), "a"], ["other", null]]);

const LONG_KEY = "long-key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const out: string[] = [];

function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.length > 30 ? value.slice(0, 30) + "~" + value.length : value);
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "object" && value !== null) return "object";
  return String(value);
}

function say(...parts: unknown[]) {
  out.push(parts.map(show).join(" "));
}

function digest(list: unknown[]): string {
  let hash = 17;
  const text = list.map(show).join(",");
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return list.length + ":" + hash;
}

function pairs(map: Map<string, unknown>): unknown[] {
  const list: unknown[] = [];
  for (const [key, value] of map) list.push(key, value);
  return list;
}

function joined(a: string, b: string): string {
  return a + b;
}

function lookupKeys(first: string, other: string): [string, string][] {
  const half = first.length >> 1;
  const wide = "中" + other;
  return [
    ["flat", other],
    ["rope", joined(first.slice(0, half), first.slice(half))],
    ["substring", ("<<" + other + ">>").slice(2, -2)],
    ["two-byte equal", wide.slice(1)],
    ["two-byte absent", wide],
    ["absent", other + "!"],
    ["empty", ""],
  ];
}

function checkSet(name: string, make: () => Set<string>, first: string, other: string) {
  const original = make();
  say(name, "size", original.size, digest([...original]));
  for (const [kind, key] of lookupKeys(first, other)) say(name, kind, original.has(key));

  const kept = make();
  const changed = make();
  say(name, "distinct objects", kept !== changed);
  say(name, "add present", changed.add(first) === changed, changed.size, digest([...changed]));
  changed.add("added");
  say(name, "add", changed.size, changed.has("added"), [...changed].at(-1), kept.size, kept.has("added"));

  const removed = make();
  say(name, "delete absent", removed.delete("no such key"), removed.size);
  say(name, "delete", removed.delete(first), removed.has(first), removed.size, digest([...removed]));
  removed.add(first);
  say(name, "add again", removed.size, [...removed].at(-1));

  const cleared = make();
  cleared.clear();
  say(name, "clear", cleared.size, cleared.has(first), [...cleared].length);
  cleared.add("after clear");
  say(name, "add after clear", digest([...cleared]));

  const grown = make();
  let seen = 0;
  for (const key of grown) {
    if (seen === 0) {
      grown.add("during");
      grown.delete(other);
    }
    seen++;
    if (key === "during") say(name, "reached added key", seen);
  }
  say(name, "changed during for-of", seen, grown.size, grown.has(other));

  const emptied = make();
  let steps = 0;
  for (const key of emptied) {
    steps++;
    emptied.clear();
    if (steps === 1) emptied.add(key + "-next");
  }
  say(name, "cleared during for-of", steps, digest([...emptied]));
  say(name, "kept", digest([...kept]), digest([...make()]));
}

function checkMap(name: string, make: () => Map<string, unknown>, first: string, other: string) {
  const original = make();
  say(name, "size", original.size, digest(pairs(original)));
  for (const [kind, key] of lookupKeys(first, other)) say(name, kind, original.has(key), original.get(key));

  const kept = make();
  const changed = make();
  say(name, "distinct objects", kept !== changed);
  const before = changed.get(other);
  say(name, "set present", changed.set(other, before) === changed, changed.size, digest(pairs(changed)));
  changed.set(other, 1.5);
  say(name, "set double", changed.get(other), kept.get(other), changed.size);
  changed.set(first, { changed: true });
  say(name, "set object", changed.get(first), kept.get(first));
  changed.set("added", "value");
  say(name, "set new", changed.size, changed.get("added"), [...changed.keys()].at(-1), kept.size, kept.has("added"));

  const removed = make();
  say(name, "delete absent", removed.delete("no such key"), removed.size);
  say(name, "delete", removed.delete(first), removed.has(first), removed.get(first), removed.size, digest(pairs(removed)));
  removed.set(first, null);
  say(name, "set again", removed.size, [...removed.keys()].at(-1));

  const cleared = make();
  cleared.clear();
  say(name, "clear", cleared.size, cleared.get(first), [...cleared].length);
  cleared.set("after clear", -0);
  say(name, "set after clear", digest(pairs(cleared)));

  const grown = make();
  let seen = 0;
  for (const [key, value] of grown) {
    if (seen === 0) {
      say(name, "first pair", key, value);
      grown.set("during", 2);
      grown.set(first, "replaced");
      grown.delete(other);
    }
    seen++;
    if (key === "during") say(name, "reached added key", seen, value);
  }
  say(name, "changed during for-of", seen, grown.size, grown.get(first), grown.has(other));

  const emptied = make();
  let steps = 0;
  for (const [key] of emptied) {
    steps++;
    emptied.clear();
    if (steps === 1) emptied.set(key + "-next", steps);
  }
  say(name, "cleared during for-of", steps, digest(pairs(emptied)));
  say(name, "kept", digest(pairs(kept)), digest(pairs(make())));
}

checkSet("set 1", makeSetOf1, "only", "only");
checkSet("set 8", makeSetOf8, LONG_KEY, "key-7");
checkSet("set 9", makeSetOf9, LONG_KEY, "key-8");
checkSet("set 255", makeSetOf255, LONG_KEY, "key-200");
checkSet("set 300", makeSetOf300, LONG_KEY, "key-299");
checkMap("map 1", makeMapOf1, "only", "only");
checkMap("map 8", makeMapOf8, LONG_KEY, "key-7");
checkMap("map 9", makeMapOf9, LONG_KEY, "key-8");
checkMap("map 255", makeMapOf255, LONG_KEY, "key-200");
checkMap("map 300", makeMapOf300, LONG_KEY, "key-299");
checkSet("set not ASCII", makeSetNotAscii, "plain", "é");
checkMap("map not ASCII", makeMapNotAscii, "plain", "é");
checkSet("set computed", makeSetComputed, "plain", "computed-2");
checkMap("map computed", makeMapComputed, "plain", "computed-2");

const values = makeMapOf9();
for (const [key, value] of values) say("value", key, value, typeof value);
console.log(out.join("\n"));
