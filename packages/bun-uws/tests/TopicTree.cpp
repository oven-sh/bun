#include "../src/TopicTree.h"

#include <cassert>
#include <iostream>

/* Modifying the topicTree inside callback is not allowed, we had
 * tests for this before but we never need this to work anyways.
 * Closing a socket when reaching too much backpressure is done
 * deferred to next event loop iteration so we never need to modify
 * topicTree inside callback - removed this test */

/* This tests pretty much all features for obvious incorrectness */
void testCorrectness() {
    std::cout << "TestCorrectness" << std::endl;

    uWS::TopicTree<std::string, std::string_view> *topicTree;
    std::map<void *, std::string> expectedResult;
    std::map<void *, std::string> actualResult;

    topicTree = new uWS::TopicTree<std::string, std::string_view>([&topicTree, &actualResult](uWS::Subscriber *s, std::string &message, auto flags) {

        actualResult[s] += message;

        /* Success */
        return false;
    });

    uWS::Subscriber *s1 = topicTree->createSubscriber();
    uWS::Subscriber *s2 = topicTree->createSubscriber();

    /* Make sure s1 < s2 (for debugging) */
    if (s2 < s1) {
        uWS::Subscriber *tmp = s1;
        s1 = s2;
        s2 = tmp;
    }

    /* Publish to topic3 - nobody should see this */
    topicTree->publish(nullptr, "topic3", "Nobody should see");

    /* Subscribe s1 to topic3 - s1 should not see above message */
    topicTree->subscribe(s1, "topic3");

    /* Publish to topic3 with s1 as sender - s1 should not get its own messages */
    topicTree->publish(s1, "topic3", "Nobody should see");

    /* Subscribe s2 to topic3 - should not get any message */
    topicTree->subscribe(s2, "topic3");

    /* Publish to topic3 without sender - both should see */
    topicTree->publish(nullptr, "topic3", "Both should see");

    /* Publish to topic3 with s2 as sender - s1 should see */
    topicTree->publish(s2, "topic3", "s1 should see, not s2");

    /* Publish to topic3 with s1 as sender - s2 should see */
    topicTree->publish(s1, "topic3", "s2 should see, not s1");

    /* Publish to topic3 without sender - both should see */
    topicTree->publish(nullptr, "topic3", "Again, both should see this as well");

    // todo: add more cases involving more topics and duplicates, etc

    /* Fill out expectedResult */
    expectedResult = {
        {s1, "Both should sees1 should see, not s2Again, both should see this as well"},
        {s2, "Both should sees2 should see, not s1Again, both should see this as well"}
    };

    /* Compare result with expected result for every subscriber */
    topicTree->drain();
    for (auto &p : expectedResult) {
        std::cout << "Subscriber: " << p.first << std::endl;

        if (p.second != actualResult[p.first]) {
            std::cout << "ERROR: <" << actualResult[p.first] << "> should be <" << p.second << ">" << std::endl;
            exit(1);
        }
    }

    /* Release resources */
    topicTree->freeSubscriber(s1);
    topicTree->freeSubscriber(s2);

    delete topicTree;
}

void testBugReport() {
    std::cout << "TestBugReport" << std::endl;

    uWS::TopicTree<std::string, std::string_view> *topicTree;
    std::map<void *, std::string> expectedResult;
    std::map<void *, std::string> actualResult;

    topicTree = new uWS::TopicTree<std::string, std::string_view>([&topicTree, &actualResult](uWS::Subscriber *s, std::string &message, auto flags) {

        actualResult[s] += message;

        /* Success */
        return false;
    });

    uWS::Subscriber *s1 = topicTree->createSubscriber();
    uWS::Subscriber *s2 = topicTree->createSubscriber();

    /* Make sure s1 < s2 (for debugging) */
    if (s2 < s1) {
        uWS::Subscriber *tmp = s1;
        s1 = s2;
        s2 = tmp;
    }

    /* Each subscriber to its own topic */
    topicTree->subscribe(s1, "b1");
    topicTree->subscribe(s2, "b2");

    /* This one should send b2 to s2 */
    topicTree->publish(s1, "b1", "b1");
    topicTree->publish(s1, "b2", "b2");

    /* This one should send b1 to s1 */
    topicTree->publish(s2, "b1", "b1");
    topicTree->publish(s2, "b2", "b2");

    /* Fill out expectedResult */
    expectedResult = {
        {s1, "b1"},
        {s2, "b2"}
    };

    /* Compare result with expected result for every subscriber */
    topicTree->drain();
    for (auto &p : expectedResult) {
        std::cout << "Subscriber: " << p.first << std::endl;

        if (p.second != actualResult[p.first]) {
            std::cout << "ERROR: <" << actualResult[p.first] << "> should be <" << p.second << ">" << std::endl;
            exit(1);
        }
    }

    /* Release resources */
    topicTree->freeSubscriber(s1);
    topicTree->freeSubscriber(s2);

    delete topicTree;
}

void testReorderingv19() {
    std::cout << "TestReorderingv19" << std::endl;

    uWS::TopicTree<std::string, std::string_view> *topicTree;
    std::map<void *, std::string> expectedResult;
    std::map<void *, std::string> actualResult;

    topicTree = new uWS::TopicTree<std::string, std::string_view>([&topicTree, &actualResult](uWS::Subscriber *s, std::string &message, auto flags) {

        actualResult[s] += message;

        /* Success */
        return false;
    });

    uWS::Subscriber *s1 = topicTree->createSubscriber();

    /* Subscribe to 100 topics */
    for (int i = 0; i < 100; i++) {
        topicTree->subscribe(s1, std::to_string(i));
    }

    /* Publish to 100 topics in order with messages in order */
    for (int i = 0; i < 100; i++) {
        topicTree->publish(nullptr, std::to_string(i), std::to_string(i) + ",");

        expectedResult[s1].append(std::to_string(i) + ",");
    }

    /* Compare result with expected result for every subscriber */
    topicTree->drain();
    for (auto &p : expectedResult) {
        std::cout << "Subscriber: " << p.first << std::endl;

        if (p.second != actualResult[p.first]) {
            std::cout << "ERROR: <" << actualResult[p.first] << "> should be <" << p.second << ">" << std::endl;
            exit(1);
        }
    }

    /* Release resources */
    topicTree->freeSubscriber(s1);

    delete topicTree;
}

int main() {
    testCorrectness();
    testBugReport();
    testReorderingv19();
}