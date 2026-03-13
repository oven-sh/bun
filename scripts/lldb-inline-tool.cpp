/*
 * LLDB Inline Debug Tool
 * 
 * This tool allows you to add inline debug points in your code using comments:
 *   // LOG: message here
 *   // LOG: variable value is {variable_name}
 * 
 * The tool will set non-stopping breakpoints at these locations and print
 * the messages when hit, without interrupting program execution.
 * 
 * BUILD INSTRUCTIONS:
 * ------------------
 * On macOS with Homebrew LLVM:
 *   c++ -std=c++17 -o lldb-inline lldb-inline-tool.cpp \
 *       -llldb \
 *       -L/opt/homebrew/opt/llvm/lib \
 *       -I/opt/homebrew/opt/llvm/include \
 *       -Wl,-rpath,/opt/homebrew/opt/llvm/lib
 * 
 * On Linux:
 *   c++ -std=c++17 -o lldb-inline lldb-inline-tool.cpp \
 *       -llldb \
 *       -L/usr/lib/llvm-14/lib \
 *       -I/usr/lib/llvm-14/include
 * 
 * USAGE:
 * ------
 *   ./lldb-inline <executable> [args...]
 * 
 * The tool searches for // LOG: comments in all source files listed in
 * cmake/sources/ *.txt and sets breakpoints at those locations.
 */

#include <lldb/API/LLDB.h>
#include <iostream>
#include <vector>
#include <string>
#include <cstdlib>
#include <regex>
#include <unistd.h>
#include <glob.h>
#include <fstream>
#include <chrono>
#include <set>
#include <thread>
#include <atomic>
#include <signal.h>
#include <errno.h>

extern char **environ;

using namespace lldb;

struct DebugPoint {
    std::string file;
    int line;
    int column;
    enum Type { LOG, VAR } type;
    std::string data;
};

std::vector<DebugPoint> debugPoints;

bool logpointCallback(void *baton, SBProcess &process, SBThread &thread, SBBreakpointLocation &location) {
    auto start = std::chrono::high_resolution_clock::now();
    
    auto* point = static_cast<DebugPoint*>(baton);
    
    std::cout << point->file << ":" << point->line << ":" << point->column << " ";
    
    // Parse the log message for {expressions}
    std::string msg = point->data;
    size_t pos = 0;
    
    while ((pos = msg.find('{', pos)) != std::string::npos) {
        size_t endPos = msg.find('}', pos);
        if (endPos == std::string::npos) {
            break;
        }
        
        // Extract expression
        std::string expr = msg.substr(pos + 1, endPos - pos - 1);
        
        // Evaluate expression
        SBFrame frame = thread.GetFrameAtIndex(0);
        SBValue result = frame.EvaluateExpression(expr.c_str());
        
        std::string value;
        if (result.GetError().Success() && result.GetValue()) {
            value = result.GetValue();
        } else {
            value = "<error>";
        }
        
        // Replace {expression} with value
        msg.replace(pos, endPos - pos + 1, value);
        pos += value.length();
    }
    
    std::cout << msg << std::endl;
    
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Breakpoint callback took: " << duration.count() << "ms" << std::endl;
    
    // Don't stop
    return false;
}

std::vector<std::string> getSourceFiles() {
    std::vector<std::string> files;
    
    // Read cmake source files
    glob_t globbuf;
    if (glob("cmake/sources/*.txt", 0, nullptr, &globbuf) == 0) {
        for (size_t i = 0; i < globbuf.gl_pathc; i++) {
            std::ifstream file(globbuf.gl_pathv[i]);
            std::string line;
            while (std::getline(file, line)) {
                if (!line.empty() && line[0] != '#' && line.find("${") == std::string::npos) {
                    files.push_back(line);
                }
            }
        }
        globfree(&globbuf);
    }
    
    return files;
}

void findDebugPoints() {
    // Get source files
    auto files = getSourceFiles();
    
    if (files.empty()) {
        return;
    }
    
    // Create temp file with list of files
    std::string tmpfile = "/tmp/lldb-inline-files.txt";
    std::ofstream out(tmpfile);
    for (const auto& file : files) {
        out << file << std::endl;
    }
    out.close();
    
    // Use ripgrep with limited threads for speed
    std::string cmd = "cat " + tmpfile + " | xargs rg -j4 --line-number --column --no-heading --color=never '//\\s*LOG:'";
    
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) {
        unlink(tmpfile.c_str());
        return;
    }
    
    char buffer[1024];
    std::regex logRegex(".*//\\s*LOG:\\s*(.+)");
    
    while (fgets(buffer, sizeof(buffer), pipe)) {
        std::string line(buffer);
        // Remove trailing newline
        if (!line.empty() && line.back() == '\n') {
            line.pop_back();
        }
        
        // Parse ripgrep output: file:line:column:text
        size_t pos1 = line.find(':');
        if (pos1 == std::string::npos) continue;
        
        size_t pos2 = line.find(':', pos1 + 1);
        if (pos2 == std::string::npos) continue;
        
        size_t pos3 = line.find(':', pos2 + 1);
        if (pos3 == std::string::npos) continue;
        
        DebugPoint point;
        point.file = line.substr(0, pos1);
        point.line = std::stoi(line.substr(pos1 + 1, pos2 - pos1 - 1));
        point.column = std::stoi(line.substr(pos2 + 1, pos3 - pos2 - 1));
        
        std::string text = line.substr(pos3 + 1);
        
        std::smatch match;
        if (std::regex_match(text, match, logRegex)) {
            point.type = DebugPoint::LOG;
            point.data = match[1];  // The message is in capture group 1
            // Trim whitespace
            point.data.erase(0, point.data.find_first_not_of(" \t"));
            point.data.erase(point.data.find_last_not_of(" \t") + 1);
            debugPoints.push_back(point);
        }
    }
    
    pclose(pipe);
    unlink(tmpfile.c_str());
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        return 1;
    }
    
    const char* executable = argv[1];
    
    // Find debug points
    auto start = std::chrono::high_resolution_clock::now();
    findDebugPoints();
    auto end = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Ripgrep search took: " << duration.count() << "ms" << std::endl;
    
    
    if (debugPoints.empty()) {
        return 1;
    }
    
    // Initialize LLDB
    start = std::chrono::high_resolution_clock::now();
    SBDebugger::Initialize();
    SBDebugger debugger = SBDebugger::Create(false); // Don't read .lldbinit
    debugger.SetAsync(true);
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "LLDB init took: " << duration.count() << "ms" << std::endl;
    
    // Keep LLDB's stdio handling enabled
    SBCommandInterpreter interpreter = debugger.GetCommandInterpreter();
    SBCommandReturnObject result;
    interpreter.HandleCommand("settings set target.disable-stdio false", result);
    interpreter.HandleCommand("settings set symbols.load-on-demand true", result);
    interpreter.HandleCommand("settings set target.preload-symbols false", result);
    interpreter.HandleCommand("settings set symbols.enable-external-lookup false", result);
    interpreter.HandleCommand("settings set target.auto-import-clang-modules false", result);
    interpreter.HandleCommand("settings set target.detach-on-error true", result);
    
    // Create target
    SBError error;
    char cwd[PATH_MAX];
    getcwd(cwd, sizeof(cwd));
    
    std::string fullPath = executable;
    if (fullPath[0] != '/') {
        fullPath = std::string(cwd) + "/" + executable;
    }
    
    start = std::chrono::high_resolution_clock::now();
    SBTarget target = debugger.CreateTarget(fullPath.c_str(), nullptr, nullptr, false, error);
    if (!target.IsValid()) {
        std::cerr << "Failed to create target: " << error.GetCString() << std::endl;
        return 1;
    }
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Create target took: " << duration.count() << "ms" << std::endl;
    
    // Set breakpoints
    start = std::chrono::high_resolution_clock::now();
    for (auto& point : debugPoints) {
        std::string absPath = point.file;
        if (absPath[0] != '/') {
            absPath = std::string(cwd) + "/" + point.file;
        }
        
        SBBreakpoint bp = target.BreakpointCreateByLocation(absPath.c_str(), point.line);
        if (bp.IsValid()) {
            bp.SetCallback(logpointCallback, &point);
        }
    }
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Set breakpoints took: " << duration.count() << "ms" << std::endl;
    
    // Build args
    std::vector<const char*> args;
    for (int i = 2; i < argc; i++) {
        args.push_back(argv[i]);
    }
    args.push_back(nullptr);
    
    // Launch process with proper settings
    SBLaunchInfo launch_info(args.data());
    launch_info.SetWorkingDirectory(cwd);
    launch_info.SetLaunchFlags(0);  // Don't disable stdio
    
    // Pass through environment variables from parent
    SBEnvironment env = launch_info.GetEnvironment();
    for (char **p = environ; *p != nullptr; p++) {
        env.PutEntry(*p);
    }
    launch_info.SetEnvironment(env, false);
    
    start = std::chrono::high_resolution_clock::now();
    SBProcess process = target.Launch(launch_info, error);
    if (!process.IsValid()) {
        std::cerr << "Failed to launch process: " << error.GetCString() << std::endl;
        return 1;
    }
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Launch process took: " << duration.count() << "ms" << std::endl;
    
    // lldb::pid_t launchedPid = process.GetProcessID();
    // std::cerr << "Launched process with PID: " << launchedPid << std::endl;
    
    // Handle events properly
    SBListener listener = debugger.GetListener();
    
    start = std::chrono::high_resolution_clock::now();
    auto lastOutput = start;
    bool done = false;
    bool gotOutput = false;
    
    int eventCount = 0;
    while (!done) {
        SBEvent event;
        if (listener.WaitForEvent(0, event)) {  // Non-blocking
            eventCount++;
            auto eventTime = std::chrono::high_resolution_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(eventTime - start);
            StateType state = SBProcess::GetStateFromEvent(event);
            // std::cerr << "Event #" << eventCount << " at " << elapsed.count() << "ms: state=" << state << std::endl;
            if (state == eStateExited) {
                auto exitTime = std::chrono::high_resolution_clock::now();
                auto totalTime = std::chrono::duration_cast<std::chrono::milliseconds>(exitTime - start);
                // std::cerr << "Process exited with code: " << process.GetExitStatus() << " after " << totalTime.count() << "ms in event loop" << std::endl;
            }
            
            switch (state) {
                case eStateStopped:
                    process.Continue();
                    break;
                    
                case eStateRunning:
                    break;
                    
                case eStateExited:
                case eStateCrashed:
                case eStateDetached:
                    // std::cerr << "Exiting immediately on state: " << state << std::endl;
                    // Just exit immediately - skip all cleanup
                    exit(process.GetExitStatus());
                    break;
                    
                default:
                    break;
            }
        } else {
            // No event, check if process is done
            StateType currentState = process.GetState();
            if (currentState == eStateExited || currentState == eStateCrashed || currentState == eStateDetached) {
                done = true;
                end = std::chrono::high_resolution_clock::now();
                duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - lastOutput);
                // std::cerr << "Process already exited, detected by polling. Time from last output: " << duration.count() << "ms" << std::endl;
            }
        }
        
        // Read and forward stdout/stderr
        char buffer[1024];
        size_t num_bytes;
        
        bool hadStdout = false;
        while ((num_bytes = process.GetSTDOUT(buffer, sizeof(buffer)-1)) > 0) {
            buffer[num_bytes] = '\0';
            std::cout << buffer;
            std::cout.flush();
            lastOutput = std::chrono::high_resolution_clock::now();
            gotOutput = true;
            hadStdout = true;
        }
        
        bool hadStderr = false;
        while ((num_bytes = process.GetSTDERR(buffer, sizeof(buffer)-1)) > 0) {
            buffer[num_bytes] = '\0';
            std::cerr << buffer;
            std::cerr.flush();
            lastOutput = std::chrono::high_resolution_clock::now();
            gotOutput = true;
            hadStderr = true;
        }
        
        // Poll process state every iteration
        StateType currentState = process.GetState();
        if (currentState == eStateExited || currentState == eStateCrashed || currentState == eStateDetached) {
            // Process has exited, break out of loop
            done = true;
        } else {
            // Small sleep to avoid busy-waiting  
            usleep(10000);  // 10ms
        }
    }
    
    int exit_code = process.GetExitStatus();
    
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Total event loop time: " << duration.count() << "ms" << std::endl;
    
    // Cleanup
    start = std::chrono::high_resolution_clock::now();
    SBDebugger::Destroy(debugger);
    end = std::chrono::high_resolution_clock::now();
    duration = std::chrono::duration_cast<std::chrono::milliseconds>(end - start);
    // std::cerr << "Debugger destroy took: " << duration.count() << "ms" << std::endl;
    
    SBDebugger::Terminate();
    
    return exit_code;
}